import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';
import * as tsBrowserAutomation from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import { enrichArticle } from '../src/enrich';
import {
    applyLayout,
    appmsgIdFromCanonical,
    canonicalSavedEditorUrl,
    confirmPublicPublish,
    coverAssetIdentity,
    draftRowContainers,
    enrichArticleDraft,
    fillOptional,
    insertAudioMaterial,
    type ModeRunDeps,
    openDraftBox,
    publishContent,
    readDraftBaseline,
    readPublicDraftSnapshot,
    readPublishNotifySubscribers,
    readTitleMirror,
    recoverStaleVersion,
    savePublicDraft,
    setCover,
    shouldNotifySubscribers,
    waitForPublicEditorReadiness,
} from '../src/flow';
import {
    checkWechatSession,
    getPublishTransport,
    isConsoleReady,
    isWechatLoggedIn,
    main,
    markdownToWechatHtml,
    processPublishIO,
    storageStatePath,
    WechatmpBrowserTransport,
    type WechatPage,
    wrapPlaywrightPage,
} from '../src/index';
import { CREATE_TYPES, readCreateType } from '../src/modes';
import { wrapPlaywrightContext } from '../src/page';

const tmpRoot = join(process.cwd(), '.works/tmp/test-wechat');
// The scratch tree must not survive the run: an untracked directory created DURING a
// feature-verification pass changes the tree mid-pass and fails its evidence binding.
afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});

const CONSOLE_HOME = 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=302104224';
const TOKEN = '302104224';

/** Paths the artifact validation reads off disk. */
const video = join(tmpRoot, 'clip.mp4');
const audio = join(tmpRoot, 'episode.mp3');
const cover = join(tmpRoot, 'cover.png');
const bodyImage = join(tmpRoot, 'body.png');

async function seedMedia(): Promise<void> {
    await mkdir(tmpRoot, { recursive: true });
    await Promise.all([
        writeFile(video, 'mp4'),
        writeFile(audio, 'mp3'),
        writeFile(cover, 'png'),
        writeFile(bodyImage, 'png'),
    ]);
}

const ARTICLE_TITLE = '每日 AI 资讯 — 2026-09-29';
/** The audio material the 文章 operation uploads when the 素材库 holds no same-title entry. */
const AUDIO_INPUT = { title: ARTICLE_TITLE, audioPath: '/tmp/episode.mp3', coverPath: '/tmp/episode-cover.png' };

const ARTICLE: Content = {
    title: ARTICLE_TITLE,
    body: '# 今日头条\n\n模型发布 **重点** 摘要。\n\n- 重点一\n- 重点二\n\n1. 第一步\n2. 第二步\n\n```ts\nconst x = 1;\n```',
    format: 'markdown',
    metadata: { wechatmp: { coverPath: bodyImage } },
};

function mediaContent(metadata: Record<string, unknown>, over: Partial<Content> = {}): Content {
    return { title: '模式标题', body: '正文', format: 'markdown', metadata, ...over };
}

// ---------------------------------------------------------------------------
// The offline console: two pages (the editor opens in a NEW TAB, discovery §1)
// ---------------------------------------------------------------------------

interface ConsoleState {
    /** 0272: the 原文链接 settings row is absent (unavailable capability). */
    urlRowMissing?: boolean;
    /** 0272: the 赏 dialog shows the 前往开通 prerequisite instead of the account field. */
    rewardBlocked?: boolean;
    /** 0272: the editor exposes no 一键排版 control (measured 2026-10-13). */
    layoutMissing?: boolean;
    /** November 2 console opens a full-page preview rather than the old format menu. */
    layoutPreview?: boolean;
    layoutNewTab?: boolean;
    layoutCommitRefused?: boolean;
    /** The current UEditor menu exposes the native target as nested `.edui-default` nodes. */
    layoutNativeMenu?: boolean;
    layoutNativeAmbiguous?: boolean;
    layoutNativeSaveNever?: boolean;
    /** Native layout selection completes through auto-save after this delay. */
    layoutAckDelayMs?: number;
    /** The entry page's URL; `token-in-url` decides whether the token comes from there or a link. */
    entryUrl: string;
    /** What the page-side console-link scan returns (the token's second recorded source). */
    tokenLink: string | null;
    /** Creation-menu labels the console offers. */
    menu: string[];
    /** The menu renders closed until the console's own 新的创作 control opens it. */
    menuClosed: boolean;
    /** Creating a type opens the editor in a new tab (discovery §1). */
    opensNewTab: boolean;
    /**
     * `createType` the editor tab's URL reports: `undefined` = the mode's own value, `null` = a URL
     * that carries no createType at all.
     */
    createType?: number | null;
    /** Which mode's editor body is open. */
    mode: '文章' | '贴图' | '视频' | '播客';
    /** 播客: reuse existing audio material in library. */
    podcastReuse?: boolean;
    podcastChooserConfirmFallback?: boolean;
    podcastChooserNeverCloses?: boolean;
    podcastFormDispatchFallback?: boolean;
    podcastTranscodeFails?: boolean;
    /** The 视频/播客 media modal is satisfied (the save bar exists only then, §5.1). */
    mediaSatisfied: boolean;
    /** The title block's typed text reaches the hidden `textarea#title` mirror (§5.2 trap 1). */
    mirrorFollows: boolean;
    /** The 草稿箱 `更新于` stamp shown for this run's title. */
    draftStamp: string | null;
    /** A save click refreshes that stamp — the observed draft signal. */
    saveMovesStamp: boolean;
    /** What the platform answers after 发表. */
    publish: 'sent' | 'refused' | 'missing-cover' | 'silent';
    /** Public-path save/reopen controls; absent keeps the draft-only fixture behavior unchanged. */
    publicSaveUrl?: string;
    publicInitialUrl?: string;
    publicSaveRefusal?: string;
    /** The first mass-send click can be refused as a known stale editor before confirmation opens. */
    publicPreconfirmationRefusal?: string;
    /** A second mass-send click after 查看新草稿 may be refused again; recovery must not loop. */
    publicPreconfirmationSecondRefusal?: string;
    /** The first mass-send click can leave neither the final dialog nor a known refusal. */
    publicPreconfirmationUnknown?: boolean;
    /** The mass-send dialog mounts this long after the 发表 click (measured 3.6s live on 2026-11-04). */
    publicDialogDelayMs?: number;
    /** The measured stale dialog's unique 查看新草稿 action may be absent or ambiguous. */
    publicLatestViewMissing?: boolean;
    publicLatestViewAmbiguous?: boolean;
    /** The stale dialog action can click without switching the editor; recovery must reject that state. */
    publicLatestViewNoEffect?: boolean;
    /** Same-page 查看新草稿 route evidence and its persisted identity/snapshot. */
    publicLatestUrl?: string;
    publicLatestAppmsgId?: string;
    publicLatestSnapshot?: { title?: string; body?: string; media?: string[]; cover?: string; originalUrl?: string };
    /** 查看新草稿 hydrates progressively: the first N latest-editor reads expose only a body prefix (20261104). */
    publicLatestBodyPrefixReads?: number;
    /** A pre-existing canonical editor can acknowledge the explicit save later than the URL. */
    publicSaveAckDelayMs?: number;
    /** The native save acknowledgement can fail after the save control was clicked. */
    publicSaveAckFailure?: boolean;
    /** Native editor autosave state after reopening the canonical saved editor. */
    publicPostReloadSavingPolls?: number;
    /** The canonical editor uses the measured legacy manual-save rail instead of the v2 autosave rail. */
    publicLegacyEditor?: boolean;
    /** Number of legacy readiness probes that remain unrecognized before the measured markers appear. */
    publicPostReloadLegacyReadyPolls?: number;
    publicPendingReloadSnapshot?: {
        title?: string;
        body?: string;
        media?: string[];
        cover?: string;
        originalUrl?: string;
    };
    /** Optional remote identities used by the saved-editor media lineage fixture. */
    publicComposedMedia?: string[];
    publicReloadSnapshot?: { title?: string; body?: string; media?: string[]; cover?: string; originalUrl?: string };
    publicReloadSnapshots?: Array<
        { title?: string; body?: string; media?: string[]; cover?: string; originalUrl?: string } | undefined
    >;
    /** The mass-send confirmation's 群发通知 switch; false-policy tests must turn it off. */
    publicNotifySubscribers?: boolean;
    /** The live dialog's subscriber switch may be unavailable or ambiguous. */
    publicNotifyToggle?: 'available' | 'missing' | 'ambiguous';
    /** A console modal is laid out: it covers the save bar until a close control clears it (2026-10-12). */
    dialogOpen?: boolean;
    /** The open modal offers no close control (`false` models the 插入音频 picker, which leaked). */
    dialogCloseable?: boolean;
    /** The 保存为草稿 click throws, the way a covered control times out in Playwright. */
    saveClickThrows?: boolean;
    /** The cover panel offers no 从图片库选择 entry (the 2026-10-12 console). */
    coverLibraryMissing?: boolean;
    coverDirectEntryTrap?: boolean;
    coverOpensLibraryDirectly?: boolean;
}

const STALE_STAMP = '更新于 13:00';
const FRESH_STAMP = '更新于 13:12';

function happyState(over: Partial<ConsoleState> = {}): ConsoleState {
    return {
        entryUrl: CONSOLE_HOME,
        tokenLink: null,
        menu: ['文章', '贴图', '视频', '播客'],
        menuClosed: false,
        opensNewTab: true,
        mode: '文章',
        mediaSatisfied: false,
        mirrorFollows: true,
        draftStamp: null,
        saveMovesStamp: true,
        publish: 'sent',
        ...over,
    };
}

function publicState(over: Partial<ConsoleState> = {}): ConsoleState {
    return happyState({ publicSaveUrl: savedEditorUrlFor(0), ...over });
}

interface RecordedCall {
    op: string;
    args: unknown[];
}

const menuItemLabel = (selector: string) => /new-creation__menu-item.*:has-text\("([^"]+)"\)/.exec(selector)?.[1];
const isMenuOpener = (selector: string) => selector.includes('新的创作') && menuItemLabel(selector) === undefined;
const isStampProbe = (selector: string) => selector.includes(':text("更新于")');
const isTitleBlock = (selector: string) =>
    selector.includes('data-placeholder^="请在这里输入标题"') || selector.includes('data-placeholder*="标题"');
const isMirror = (selector: string) => selector.includes('textarea#title') || selector.includes('textarea.js_title');
const isBodyBlock = (selector: string) =>
    selector.includes('.ProseMirror') &&
    (!selector.includes('data-placeholder') || selector.includes(':not([data-placeholder])'));
const isDigest = (selector: string) => selector.includes('js_description');
const isAuthor = (selector: string) => selector.includes('input#author') || selector.includes('js_author');
const isFileInput = (selector: string) => selector.includes('file') && selector.includes('type="file"');
const isModalScoped = (selector: string) =>
    selector.includes('weui-desktop-dialog') || selector.includes('.audio_dialog');
const isImageInput = (selector: string) => isFileInput(selector) && selector.includes('image/');
const isVideoInput = (selector: string) => isFileInput(selector) && selector.includes('accept*="video"');
const isAudioInput = (selector: string) =>
    selector.includes('upload-input') ||
    selector.includes('audio_id') ||
    (isFileInput(selector) && selector.includes('audio'));
const isSaveBar = (selector: string) => selector.includes('保存为草稿');
const isLayoutControl = (selector: string) => selector.includes('ailayout') || selector.includes('一键排版');
const isLayoutTarget = (selector: string) => selector.includes('匹配目标格式');
const isCoverFromContent = (selector: string) =>
    selector.includes('js_selectCoverFromContent') || selector.includes('从正文选择');
const isCoverFromLibrary = (selector: string) =>
    selector.includes('js_imagedialog') || selector.includes('从图片库选择');
/**
 * The 文章 settings rows the enrichment rail opens: 原创 / 赞赏 / 合集 / 原文链接 / 创作来源.
 * The rail resolves each row before clicking it, so the fake has to model them.
 */
const isSettingsRow = (selector: string) =>
    selector.includes('#js_original .setting-group__') ||
    selector.includes('js_reward_open') ||
    selector.includes('js_reward_allow_click') ||
    selector.includes('js_can_reward') ||
    selector.includes('js_article_tags_label') ||
    selector.includes('js_article_url_allow_click') ||
    selector.includes('js_claim_source');
const isCoverOpener = (selector: string) =>
    selector.includes('js_cover_btn_area') || selector.includes('换一张') || selector.includes('修改');
const isCoverItem = (selector: string) => selector.includes('cover') && selector.includes(' li');
const isConfirm = (selector: string) =>
    selector.includes('确定') || selector.includes('确认') || selector.includes('完成');
const isPublishDialogHeading = (selector: string) =>
    selector.includes('weui-desktop-dialog:visible') && selector.includes('h3') && selector.includes('发表');
const isPublishNotifyToggle = (selector: string) =>
    selector.includes('weui-desktop-dialog:visible') &&
    selector.includes('mass_send__notify') &&
    selector.includes('weui-desktop-switch__input');
const isPublishFinal = (selector: string) =>
    selector.includes('weui-desktop-dialog:visible') &&
    selector.includes('mass-send__footer') &&
    selector.includes('weui-desktop-btn_primary') &&
    selector.includes('发表');
const isViewLatest = (selector: string) =>
    selector.includes('version_fail_dialog:visible') && selector.includes('查看新草稿');
const isVideoUpload = (selector: string) => selector.includes('本地上传');
const isPodcastUpload = (selector: string) =>
    selector.includes('上传音频') && !selector.includes('weui-desktop-dialog');
const isPodcastInsert = (selector: string) => selector.includes('插入');
// Not a publish *control*: the toast labels 发表成功 / …无法发表 also carry the word.
const isPublishControl = (selector: string) =>
    !isPublishDialogHeading(selector) &&
    !isPublishNotifyToggle(selector) &&
    !isPublishFinal(selector) &&
    !selector.includes(':text(') &&
    (selector.includes('mass_send') || selector.includes('发表'));
const successProbe = (selector: string) => /:text\("(发表成功|已发表)"\)/.exec(selector)?.[1];
const refusalProbe = (selector: string) =>
    /:text\("(内容不完整，无法发表|请补充封面图|必须插入一张图片|未设置头像与名称|未设置头像和名称|公众号尚未实名|当前编辑的草稿不是最新版本)"\)/.exec(
        selector,
    )?.[1];

/** Records every driver call and scripts the console UI the flow reads back. */
function makeConsole(initial: ConsoleState) {
    const state: ConsoleState = { ...initial };
    const calls: Record<'entry' | 'editor', RecordedCall[]> = { entry: [], editor: [] };
    const closed: number[] = [];
    let editorPage: ReturnType<typeof makePage> | null = null;
    let layoutPage: ReturnType<typeof makePage> | null = null;
    let mirrorValue = '';
    let pastedHtml = '';
    let pickerOpen = false;
    let podcastUploadOpen = false;
    let podcastChooserOpen = false;
    let podcastSaved = false;
    let coverPanelOpen = false;
    let wrongCoverPanel = false;
    // The mass-send confirm dialog appears once the 发表 control is clicked, until confirmed.
    let publishConfirmPending = false;
    let publishClickedAt = 0;
    let dialogOpen = initial.dialogOpen === true;
    let layoutOpen = false;
    let layoutCommitStartedAt = 0;
    let layoutApplied = false;
    let uploads: string[] = [];
    // 0260: the settings rail's committed state (a confirmed dialog commits its setting), the
    // pending dialog kind, the chosen 创作来源 label, and the committed cover asset src.
    const enriched = { original: false, reward: false, claim: false, claimText: '' };
    let pendingDialog: 'original' | 'reward' | 'claim' | 'url' | 'collection' | null = null;
    let chosenClaim = '';
    let urlValue = '';
    let coverCommittedSrc = '';
    let publicSaveClicked = false;
    let publicSaveAcknowledged = false;
    let publicCanonicalGotos = 0;
    let latestViewed = false;
    let latestPrefixReads = 0;
    let publicPostReloadSaveStatePolls = 0;
    let publicLegacyReadinessPolls = 0;
    let notifySubscribers = state.publicNotifySubscribers ?? true;

    const activePreconfirmationRefusal = (): string | undefined =>
        latestViewed ? state.publicPreconfirmationSecondRefusal : state.publicPreconfirmationRefusal;

    const entryAttached = (selector: string): boolean => {
        const label = menuItemLabel(selector);
        if (label !== undefined) return state.menu.includes(label) && !state.menuClosed;
        if (isMenuOpener(selector)) return state.menuClosed;
        // The 草稿箱 row: only the console home shows it, and only for this run's title.
        if (isStampProbe(selector)) return state.draftStamp !== null;
        return false;
    };

    const editorAttached = (selector: string): boolean => {
        if (selector.includes('选择图片'))
            return state.mode === '播客'
                ? podcastChooserOpen
                : state.coverOpensLibraryDirectly === true && coverPanelOpen;
        if (isStampProbe(selector)) return false; // the editor carries no 草稿箱 container
        const success = successProbe(selector);
        if (success !== undefined) return state.publish === 'sent';
        const refusal = refusalProbe(selector);
        if (refusal !== undefined) {
            if (refusal === '当前编辑的草稿不是最新版本')
                return (
                    selector.includes('version_fail_dialog:visible') &&
                    (state.publicSaveRefusal !== undefined ||
                        (publishConfirmPending && activePreconfirmationRefusal() !== undefined))
                );
            return refusal === '必须插入一张图片' ? state.publish === 'missing-cover' : state.publish === 'refused';
        }
        if (isViewLatest(selector))
            return (
                publishConfirmPending &&
                activePreconfirmationRefusal() !== undefined &&
                state.publicLatestViewMissing !== true
            );
        if (isPublishNotifyToggle(selector))
            return publishConfirmPending && (state.publicNotifyToggle ?? 'available') !== 'missing';
        if (isPublishDialogHeading(selector))
            return (
                publishConfirmPending &&
                Date.now() - publishClickedAt >= (state.publicDialogDelayMs ?? 0) &&
                activePreconfirmationRefusal() === undefined &&
                state.publicPreconfirmationUnknown !== true
            );
        if (isPublishFinal(selector))
            return (
                publishConfirmPending &&
                activePreconfirmationRefusal() === undefined &&
                state.publicPreconfirmationUnknown !== true
            );
        if (isTitleBlock(selector) || isMirror(selector) || isDigest(selector) || isAuthor(selector)) return true;
        if (isBodyBlock(selector)) return true;
        if (isImageInput(selector))
            return !isModalScoped(selector) || state.mode === '文章' || (state.mode === '播客' && pickerOpen);
        if (isVideoInput(selector)) return state.mode === '视频' && pickerOpen;
        // 0272 measured: the 文章 audio dialog carries its own file inputs; only 播客 gates behind the picker.
        if (isAudioInput(selector)) return state.mode === '播客' ? pickerOpen : isModalScoped(selector);
        // The dialog's own form controls (upload buttons + title field) live in the same modal.
        if (selector.includes('上传音频') && selector.includes('weui-desktop-dialog')) return podcastUploadOpen;
        if (selector.includes('上传音频') || selector.includes('上传封面'))
            return state.mode === '文章' || (state.mode === '播客' && (podcastUploadOpen || !podcastSaved));
        if (isSaveBar(selector))
            return (
                state.mode === '文章' || state.mode === '贴图' || state.mediaSatisfied || state.podcastReuse === true
            );
        if (selector.includes('使用此排版')) return state.layoutPreview === true && layoutOpen;
        if (isLayoutTarget(selector)) {
            if (state.layoutNativeMenu === true) return selector.includes('edui-popup') && layoutOpen;
            if (state.layoutPreview === true) return false;
            return state.mode === '文章' && state.layoutMissing !== true;
        }
        if (isLayoutControl(selector)) return state.mode === '文章' && state.layoutMissing !== true;
        // 0272 measured 2026-10-13: the 原文链接 row is absent on some accounts, and a 赏-blocked
        // dialog carries the 前往开通 prerequisite instead of the account field.
        if (selector.includes('js_article_url_allow_click') && state.urlRowMissing === true) return false;
        if (selector.includes('前往开通') || selector.includes('无法开启')) return state.rewardBlocked === true;
        if (
            pendingDialog === 'url' &&
            (selector.includes('popover_inner') ||
                selector.includes('input.js_url') ||
                selector.includes('jsPopoverBt'))
        )
            return true;
        if (isSettingsRow(selector)) return state.mode === '文章';
        if (isCoverOpener(selector) || isCoverFromContent(selector)) return true;
        if (isCoverFromLibrary(selector))
            return state.coverLibraryMissing !== true && !wrongCoverPanel && state.coverOpensLibraryDirectly !== true;
        if (isCoverItem(selector)) return coverPanelOpen;
        if (selector.includes('upload_cover_text') || selector.includes('select_audio_cover')) return podcastUploadOpen;
        if (selector.includes('audio_item_wrp') || selector.includes('audio_item'))
            return state.mode === '播客' && (podcastSaved || state.podcastReuse === true);
        if (isVideoUpload(selector)) return state.mode === '视频';
        if (isPodcastUpload(selector))
            return state.mode === '播客' && !state.podcastReuse && (podcastUploadOpen || !podcastSaved);
        if (isPodcastInsert(selector)) return state.mode === '播客';
        if (isConfirm(selector)) {
            if (state.mode === '视频') return pickerOpen;
            if (coverPanelOpen || publishConfirmPending) return true;
            return state.publish === 'refused';
        }
        // The settings/choice dialogs the enrichment rail and the cover panel open.
        if (isModalScoped(selector) && !isFileInput(selector) && !isConfirm(selector)) return true;
        if (isPublishControl(selector)) return true;
        if (selector.includes('placeholder*="合集"')) return true;
        return false;
    };

    const isToastProbe = (selector: string) =>
        successProbe(selector) !== undefined || refusalProbe(selector) !== undefined;

    function makePage(role: 'entry' | 'editor') {
        const log = calls[role];
        let url = role === 'entry' ? state.entryUrl : (state.publicInitialUrl ?? editorUrlFor(modeCreateType()));
        const attached = (selector: string): boolean => {
            if (role === 'entry') return entryAttached(selector);
            if (selector.includes('使用此排版') && state.layoutNewTab === true && page !== layoutPage) return false;
            // A toast surface is only "visible" for the recorded outcome; the body never satisfies it.
            if (isToastProbe(selector) || isStampProbe(selector)) return editorAttached(selector);
            if (isFileInput(selector)) return editorAttached(selector);
            return editorAttached(selector);
        };
        const page: WechatPage = {
            saveDraftAndWait: async (selector, timeoutMs) => {
                log.push({ op: 'saveDraftAndWait', args: [selector, timeoutMs] });
                if (role !== 'editor') throw new Error('native article save requires the editor page');
                const save = page.locator(selector).first();
                await save.click();
                const delay = state.publicSaveAckDelayMs ?? 0;
                if (delay > timeoutMs) {
                    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
                    throw new Error('native article save acknowledgement timed out');
                }
                if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
                if (state.publicSaveAckFailure === true) throw new Error('native article save acknowledgement failed');
                publicSaveAcknowledged = true;
                log.push({ op: 'saveDraftAck', args: [selector] });
            },
            goto: async (target) => {
                log.push({ op: 'goto', args: [target] });
                url = target;
                if (target.includes('appmsgid=') && !target.includes('isNew=1')) publicCanonicalGotos += 1;
            },
            url: () => url,
            frames: () => [
                {
                    url: () => 'https://mp.weixin.qq.com/frame1',
                    locator: () => ({ count: async () => 0 }),
                },
                {
                    url: () => 'https://mp.weixin.qq.com/frame2',
                    locator: () => ({
                        count: async () => {
                            throw new Error('boom');
                        },
                    }),
                },
            ],
            locator: (selector) => {
                log.push({ op: 'locator', args: [selector] });
                const count = async () => {
                    if (role === 'editor' && isPublishNotifyToggle(selector)) {
                        if (!editorAttached(selector)) return 0;
                        return state.publicNotifyToggle === 'ambiguous' ? 2 : 1;
                    }
                    if (role === 'editor' && isViewLatest(selector)) {
                        if (!editorAttached(selector)) return 0;
                        return state.publicLatestViewAmbiguous === true ? 2 : 1;
                    }
                    return attached(selector) ? 1 : 0;
                };
                return {
                    count,
                    first: () => ({
                        count,
                        // Upload inputs hide behind styled controls; everything else is "visible".
                        isVisible: async () => attached(selector) && !isFileInput(selector),
                        fill: async (text) => {
                            log.push({ op: 'fill', args: [selector, text] });
                            // 0260: the 原文链接 field's value is the committed-URL readback.
                            if (selector.includes('input.js_url')) urlValue = text;
                            if (isMirror(selector)) mirrorValue = text;
                        },
                        click: async () => {
                            log.push({ op: 'click', args: [selector] });
                            if (state.saveClickThrows === true && isSaveBar(selector)) {
                                throw new Error('click: Timeout 30000ms exceeded.');
                            }
                            applyClick(selector);
                        },
                        type: async (text) => {
                            log.push({ op: 'type', args: [selector, text] });
                            if (isTitleBlock(selector) && state.mirrorFollows) mirrorValue = text;
                        },
                        waitFor: async () => undefined,
                        textContent: async () => {
                            if (isStampProbe(selector)) {
                                // The flow must never read this through the editor: no container here.
                                return state.draftStamp ?? '';
                            }
                            const success = successProbe(selector);
                            if (success !== undefined) return '发表成功';
                            const refusal = refusalProbe(selector);
                            return refusal ?? '';
                        },
                        inputValue: async () => mirrorValue,
                    }),
                };
            },
            setInputFiles: async (selector, paths) => {
                const files = Array.isArray(paths) ? [...paths] : [paths];
                log.push({ op: 'setInputFiles', args: [selector, files] });
                if (isVideoInput(selector)) uploads = [...uploads, ...files];
                else if (isAudioInput(selector)) uploads = [...uploads, ...files];
                else if (isImageInput(selector)) uploads = [...uploads, ...files];
            },
            evaluate: async (expression) => {
                log.push({ op: 'evaluate', args: [expression] });
                if (expression.includes('img.crop-img')) return '[]';
                if (state.podcastReuse && expression.includes('audio_item_wrp')) return '播客标题';
                if (expression.includes('__KK_WECHAT_PUBLISH_SNAPSHOT__')) {
                    const composedSnapshot = {
                        title: mirrorValue,
                        body: pastedHtml,
                        media: state.publicComposedMedia ?? uploads,
                        cover: coverCommittedSrc,
                        originalUrl: urlValue,
                    };
                    const persistedSnapshots = state.publicReloadSnapshots;
                    const persistedSnapshot =
                        publicCanonicalGotos > 0 &&
                        url.includes('appmsgid=') &&
                        !url.includes('isNew=1') &&
                        persistedSnapshots !== undefined
                            ? persistedSnapshots[Math.min(publicCanonicalGotos - 1, persistedSnapshots.length - 1)]
                            : undefined;
                    const hydrating = latestViewed && latestPrefixReads < (state.publicLatestBodyPrefixReads ?? 0);
                    if (hydrating) latestPrefixReads += 1;
                    const latestSnapshot = hydrating
                        ? { ...composedSnapshot, body: pastedHtml.slice(0, Math.ceil(pastedHtml.length / 2)) }
                        : latestViewed && state.publicLatestSnapshot !== undefined
                          ? { ...composedSnapshot, ...state.publicLatestSnapshot }
                          : undefined;
                    const saveAcked = publicSaveAcknowledged;
                    const pendingSnapshot =
                        publicSaveClicked && !saveAcked && state.publicPendingReloadSnapshot !== undefined
                            ? { ...composedSnapshot, ...state.publicPendingReloadSnapshot }
                            : undefined;
                    const snapshot =
                        pendingSnapshot !== undefined
                            ? pendingSnapshot
                            : latestSnapshot !== undefined
                              ? latestSnapshot
                              : persistedSnapshot !== undefined
                                ? persistedSnapshot
                                : publicSaveClicked &&
                                    state.publicReloadSnapshot !== undefined &&
                                    url.includes('appmsgid=') &&
                                    !url.includes('isNew=1')
                                  ? state.publicReloadSnapshot
                                  : composedSnapshot;
                    return JSON.stringify(
                        snapshot === state.publicReloadSnapshot ? { ...composedSnapshot, ...snapshot } : snapshot,
                    );
                }
                if (expression.includes('__KK_WECHAT_LAYOUT_SAVE_STATE__')) {
                    if (publicCanonicalGotos > 0) {
                        if (state.publicLegacyEditor === true) return 'unknown';
                        const savingPolls = state.publicPostReloadSavingPolls ?? 1;
                        const saveState = publicPostReloadSaveStatePolls < savingPolls ? 'saving' : 'saved';
                        publicPostReloadSaveStatePolls += 1;
                        return saveState;
                    }
                    if (state.layoutNativeSaveNever === true) return 'saving';
                    if (layoutCommitStartedAt === 0) return 'saved';
                    const ready =
                        state.layoutAckDelayMs === undefined ||
                        Date.now() - layoutCommitStartedAt >= state.layoutAckDelayMs;
                    if (ready) layoutApplied = true;
                    return ready ? 'saved' : 'saving';
                }
                if (expression.includes('__KK_WECHAT_LEGACY_EDITOR_READY__')) {
                    if (publicCanonicalGotos > 0 && state.publicLegacyEditor === true) {
                        const unrecognizedPolls = state.publicPostReloadLegacyReadyPolls ?? 0;
                        const recognized = publicLegacyReadinessPolls >= unrecognizedPolls;
                        publicLegacyReadinessPolls += 1;
                        return recognized ? 'ready' : 'unknown';
                    }
                    return 'unknown';
                }
                if (expression.includes('__KK_WECHAT_LAYOUT_TARGET__')) {
                    if (state.layoutNativeMenu !== true || !layoutOpen) return JSON.stringify({ state: 'missing' });
                    if (state.layoutNativeAmbiguous === true) return JSON.stringify({ state: 'ambiguous' });
                    layoutCommitStartedAt = Date.now();
                    return JSON.stringify({ state: 'clicked' });
                }
                if (expression.includes('mass_send__notify') && expression.includes('HTMLInputElement'))
                    return notifySubscribers;
                if (expression.includes('ClipboardEvent')) {
                    pastedHtml = /setData\('text\/html',\s*(".*?")\);/.exec(expression)?.[1] ?? '';
                    return true;
                }
                if (expression.includes('a[href*="token="]')) return state.tokenLink ?? '';
                // 0260 identity probes: the cover panel's filename identify + committed readback,
                // and the audio picker's unique-title match + post-insert verification.
                if (expression.includes('weui-desktop-img-picker__item')) {
                    const wanted = JSON.parse(/const wanted = (\[[^\]]*\])/.exec(expression)?.[1] ?? '[]') as string[];
                    coverCommittedSrc = `https://mmbiz.qpic.cn/${wanted[0] ?? ''}`;
                    return JSON.stringify({ picked: wanted.length === 1, src: coverCommittedSrc });
                }
                if (expression.includes('#js_cover_area')) return coverCommittedSrc;
                if (expression.includes('frm_checkbox_label.audio_item'))
                    return JSON.stringify({ state: 'checked', identity: 'media-audio-1' });
                if (expression.includes("state: 'noeditor'"))
                    return JSON.stringify({ state: 'top', identity: 'media-audio-1' });
                // 0260 committed-value probes: a confirmed settings dialog leaves the setting committed.
                if (expression.includes('#js_original input.weui-desktop-switch__input')) return enriched.original;
                if (expression.includes('#js_reward_setting_area')) return enriched.reward;
                if (expression.includes('.article_url_setting')) return urlValue;
                if (expression.includes('#js_claim_source_area'))
                    return { enabled: enriched.claim, text: enriched.claim ? chosenClaim : '' };
                if (expression.includes('audio_item_wrp')) {
                    if (state.podcastTranscodeFails) return '转码中';
                    return podcastSaved ? '模式标题' : 'NONE';
                }
                if (expression.includes('btn.click()')) {
                    if (state.podcastFormDispatchFallback) {
                        podcastUploadOpen = false;
                        podcastSaved = true;
                        return 'clicked';
                    }
                }
                if (expression.includes('audio_id') || expression.includes('progress__text')) {
                    return '100%';
                }
                if (expression.includes('audio-upload-dialog_agreement')) {
                    return 'checked';
                }
                if (expression.includes('saveDiagnostics') || expression.includes('__kkToasts')) {
                    return JSON.stringify({ btn: { disabled: false, offsetWidth: 100 }, fields: [], toasts: [] });
                }
                // 0272 measured audio-dialog probes: dedupe (missing → upload), the post-upload
                // default row, the service-rules acknowledgement, and the 插入 button.
                if (expression.includes("return 'norow'")) return 'checked';
                if (expression.includes("return 'missing'")) return 'missing';
                if (expression.includes('我已阅读并同意')) return 'checked';
                if (expression.includes('插入')) return true;
                // The modal probes `saveDraft` and the submit-failure inventory added on 2026-10-12.
                if (expression.includes('weui-desktop-dialog__wrp, .weui-desktop-dialog')) return dialogOpen;
                if (expression.includes('weui-desktop-dialog, .weui-desktop-dialog__wrp')) {
                    return dialogOpen ? 'weui-desktop-dialog__wrp align_edge audio_dialog :: 插入音频 上传音频' : '';
                }
                if (expression.includes('textContent')) return pastedHtml.length > 0 ? '正文' : '';
                return '';
            },
            waitForTimeout: async () => undefined,
            press: async () => undefined,
        };

        function applyClick(selector: string): void {
            if (selector.includes('__close') || selector.includes('取消')) {
                // A closeable modal goes away; `dialogCloseable: false` models the picker that leaked.
                if (state.dialogCloseable !== false) dialogOpen = false;
                pendingDialog = null;
                return;
            }
            if (isSettingsRow(selector)) {
                pendingDialog = selector.includes('#js_original .setting-group__')
                    ? 'original'
                    : selector.includes('js_reward')
                      ? 'reward'
                      : selector.includes('js_claim_source')
                        ? 'claim'
                        : selector.includes('js_article_url_allow_click')
                          ? 'url'
                          : 'collection';
                dialogOpen = true;
                return;
            }
            if (pendingDialog === 'claim' && selector.includes('label:has(')) {
                chosenClaim = /:text-is\("([^"]+)"\)/.exec(selector)?.[1] ?? chosenClaim;
            }
            if (menuItemLabel(selector) !== undefined) {
                if (state.opensNewTab) openEditor();
                return;
            }
            if (isMenuOpener(selector)) {
                state.menuClosed = false;
                return;
            }
            if (isSaveBar(selector)) {
                publicSaveClicked = true;
                if (state.saveMovesStamp) state.draftStamp = FRESH_STAMP;
                if (state.publicSaveUrl !== undefined) url = state.publicSaveUrl;
                return;
            }
            if (isLayoutControl(selector)) {
                layoutOpen = true;
                if (state.layoutNewTab === true) layoutPage = makePage('editor');
                return;
            }
            if (isLayoutTarget(selector)) return;
            if (selector.includes('使用此排版')) {
                if (state.layoutCommitRefused !== true) layoutOpen = false;
                return;
            }
            if (isViewLatest(selector)) {
                if (state.publicLatestViewNoEffect === true) return;
                latestViewed = true;
                publishConfirmPending = false;
                if (state.publicLatestUrl !== undefined) url = state.publicLatestUrl;
                else if (state.publicLatestAppmsgId !== undefined)
                    url = savedEditorUrlFor(0).replace('appmsgid=100001161', `appmsgid=${state.publicLatestAppmsgId}`);
                return;
            }
            if (isSettingsRow(selector)) return;
            if (isCoverOpener(selector) || isCoverFromContent(selector) || isCoverFromLibrary(selector)) {
                if (state.coverDirectEntryTrap && isCoverFromContent(selector)) wrongCoverPanel = true;
                coverPanelOpen = true;
                return;
            }
            if (selector.includes('upload_cover_text') || selector.includes('select_audio_cover')) {
                podcastChooserOpen = true;
                return;
            }
            if (isVideoUpload(selector) || isPodcastUpload(selector)) {
                pickerOpen = true;
                if (isPodcastUpload(selector)) podcastUploadOpen = true;
                return;
            }
            if (podcastChooserOpen && selector.includes('确定')) {
                if (state.podcastChooserNeverCloses !== true) podcastChooserOpen = false;
                return;
            }
            if (podcastChooserOpen && selector.includes('完成')) {
                if (state.podcastChooserNeverCloses !== true && state.podcastChooserConfirmFallback !== true) {
                    podcastChooserOpen = false;
                }
                return;
            }
            if (podcastUploadOpen && selector.includes('保存')) {
                if (state.podcastFormDispatchFallback !== true) {
                    podcastUploadOpen = false;
                    podcastSaved = true;
                }
                return;
            }
            if (isPodcastInsert(selector)) {
                state.mediaSatisfied = uploads.length >= 2;
                return;
            }
            if (isPublishControl(selector)) {
                publishConfirmPending = true;
                publishClickedAt = Date.now();
                return;
            }
            if (isPublishNotifyToggle(selector)) {
                notifySubscribers = false;
                return;
            }
            if (isPublishFinal(selector)) {
                publishConfirmPending = false;
                return;
            }
            if (isConfirm(selector)) {
                if (state.mode === '视频' && pickerOpen) state.mediaSatisfied = uploads.length > 0;
                if (pendingDialog === 'original') enriched.original = true;
                if (pendingDialog === 'reward') enriched.reward = true;
                if (pendingDialog === 'claim') {
                    enriched.claim = true;
                    enriched.claimText = chosenClaim;
                }
                // Only a settings dialog's 确定 closes the console dialog; the cover library's
                // generic 确定 must leave the leaked-dialog state (dialogOpen) untouched.
                if (pendingDialog !== null) {
                    pendingDialog = null;
                    dialogOpen = false;
                }
                coverPanelOpen = false;
                publishConfirmPending = false;
                return;
            }
        }
        return page;
    }

    function openEditor(): void {
        if (editorPage === null) {
            editorPage = makePage('editor');
        }
    }

    /** The editor URL's createType: the mode's own value unless a test overrides it. */
    function modeCreateType(): number | null {
        return state.createType === undefined ? CREATE_TYPES[state.mode] : state.createType;
    }

    const entry = makePage('entry');
    const opened = {
        page: entry,
        pages: () => [...(editorPage === null ? [entry] : [entry, editorPage]), ...(layoutPage ? [layoutPage] : [])],
        newPage: async () => {
            openEditor();
            const openedEditor = editorPage;
            if (openedEditor === null) throw new Error('unreachable');
            return openedEditor;
        },
        close: async () => {
            closed.push(1);
        },
    };
    return {
        state,
        opened,
        calls,
        closed,
        entryPage: entry,
        editorPage: () => editorPage,
        layoutOpened: () => layoutOpen,
        layoutApplied: () => layoutApplied,
    };
}

function editorUrlFor(createType: number | null): string {
    const base = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${TOKEN}&lang=zh_CN&timestamp=1`;
    return createType === null ? base : `${base}&createType=${createType}`;
}

function savedEditorUrlFor(createType: number | null): string {
    const url = editorUrlFor(createType)
        .replace('t=media/appmsg_edit_v2&', 't=media/appmsg_edit&')
        .replace('&isNew=1', '');
    return `${url}&appmsgid=100001161`;
}

/** A transport wired to the fake console, with the browser seams scripted. */
function makeTransport(
    console: ReturnType<typeof makeConsole>,
    over: ConstructorParameters<typeof WechatmpBrowserTransport>[0] = {},
): WechatmpBrowserTransport {
    return new WechatmpBrowserTransport({
        openPage: async () => console.opened,
        checkSession: async () => undefined,
        stepTimeoutMs: 300,
        submitSettleMs: 1,
        draftTimeoutMs: 50,
        pollMs: 5,
        submitAttempts: 1,
        ...over,
    });
}

/** The op names of one page's log. */
const opsOf = (calls: RecordedCall[]): string[] => calls.map((call) => call.op);
/** The selector arguments of one op on one page. */
const selectorsOf = (calls: RecordedCall[], op: string): string[] =>
    calls.filter((call) => call.op === op).map((call) => String(call.args[0]));

// ---------------------------------------------------------------------------
// Dispatch and pre-browser validation
// ---------------------------------------------------------------------------

describe('wechatmp-pub dispatch and validation (no browser opens)', () => {
    test('default driver is script, kind browser; the agent driver fails before any launch', async () => {
        const console = makeConsole(happyState());
        const transport = makeTransport(console, { driver: 'agent' });
        expect(transport.kind).toBe('browser');
        expect(transport.driver).toBe('agent');
        const result = await transport.publish({ content: ARTICLE, options: { target: 'wechatmp' } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('unsupported driver');
        expect(console.closed).toHaveLength(0);
    });

    test('the default operation is 文章 (the daily stage dispatches this plugin without one)', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        expect(result.metadata?.operation).toBe('文章');
    });

    test('an undeclared operation is refused by name before a browser opens', async () => {
        await seedMedia();
        for (const operation of ['直播', 'live']) {
            const console = makeConsole(happyState());
            const result = await makeTransport(console).publish({
                content: ARTICLE,
                options: { target: 'wechatmp', operation },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain(`unsupported operation '${operation}'`);
            expect(result.error).toContain('文章, 贴图, 视频, 播客');
            expect(console.closed).toHaveLength(0);
        }
    });

    test('an undeclared operation from content.metadata is refused too', async () => {
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, operation: '转载' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unsupported operation '转载'");
        expect(console.closed).toHaveLength(0);
    });

    test('unknown publishStatus is refused pre-browser; public is the only live value', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const invalid = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'archived' } },
        });
        expect(invalid.ok).toBe(false);
        expect(invalid.error).toContain('publishStatus');
        expect(console.closed).toHaveLength(0);

        const live = makeConsole(publicState());
        const publicRun = await makeTransport(live).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(publicRun.ok).toBe(true);
        expect(publicRun.metadata?.publishStatus).toBe('public');
    });

    test('missing 文章 title fails pre-browser naming the field', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, title: '  ' },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('title');
        expect(result.error).toContain('文章');
        expect(console.closed).toHaveLength(0);
    });

    test('title over the mode limit fails pre-browser (文章 64, 视频/播客 20)', async () => {
        await seedMedia();
        const article = makeConsole(happyState({ mode: '文章' }));
        const tooLong = await makeTransport(article).publish({ content: { ...ARTICLE, title: 'a'.repeat(65) } });
        expect(tooLong.ok).toBe(false);
        expect(tooLong.error).toContain('accepts ≤64');
        expect(article.closed).toHaveLength(0);

        const video = makeConsole(happyState({ mode: '视频' }));
        const videoTooLong = await makeTransport(video).publish({
            content: mediaContent({ operation: '视频', video }, { title: 'a'.repeat(21) }),
        });
        expect(videoTooLong.ok).toBe(false);
        expect(videoTooLong.error).toContain('accepts ≤20');
        expect(video.closed).toHaveLength(0);
    });

    test('摘要 over 120 and 作者 over 8 fail pre-browser', async () => {
        await seedMedia();
        const digest = makeConsole(happyState());
        const longDigest = await makeTransport(digest).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, digest: 'd'.repeat(121) } },
        });
        expect(longDigest.ok).toBe(false);
        expect(longDigest.error).toContain('≤120');
        expect(digest.closed).toHaveLength(0);

        const author = makeConsole(happyState());
        const longAuthor = await makeTransport(author).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, author: '冰原奔狼的每日AI资讯分享' } },
        });
        expect(longAuthor.ok).toBe(false);
        expect(longAuthor.error).toContain('≤8');
        expect(author.closed).toHaveLength(0);
    });

    test('文章 requires a body image — its cover comes from the body (默认首图为封面)', async () => {
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({ content: { ...ARTICLE, metadata: {} } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('cover validation');
        expect(result.error).toContain('默认首图为封面');
        expect(console.closed).toHaveLength(0);
    });

    test('body image paths are validated (relative, extension, existence)', async () => {
        await seedMedia();
        const cases: Array<[string, string]> = [
            ['body-relative.png', 'must be absolute'],
            [join(tmpRoot, 'body.bmp'), 'unsupported extension'],
            [join(tmpRoot, 'ghost.png'), 'does not exist'],
        ];
        for (const [path, expected] of cases) {
            const console = makeConsole(happyState());
            const result = await makeTransport(console).publish({
                content: { ...ARTICLE, metadata: { wechatmp: { coverPath: path } } },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain(expected);
            expect(console.closed).toHaveLength(0);
        }
    });

    test('贴图 requires ≥1 image and enforces no unrecorded cap', async () => {
        const empty = makeConsole(happyState({ mode: '贴图' }));
        const missing = await makeTransport(empty).publish({
            content: mediaContent({ operation: '贴图' }, { title: '' }),
        });
        expect(missing.ok).toBe(false);
        expect(missing.error).toContain('贴图 requires at least one image');
        expect(empty.closed).toHaveLength(0);

        // The walk recorded NO 贴图 image cap (discovery §3/§5.2), so none is invented: five
        // images pass the pre-browser gate and reach the console.
        await seedMedia();
        const images = Array.from({ length: 5 }, (_, index) => join(tmpRoot, `sticker-${index}.png`));
        await Promise.all(images.map((path) => writeFile(path, 'png')));
        const many = makeConsole(happyState({ mode: '贴图' }));
        const result = await makeTransport(many).publish({
            content: mediaContent({ operation: '贴图', images: images.map((path) => ({ path })) }, { title: '' }),
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.artifactPaths).toEqual(images);
    });

    test('视频 needs a video artifact; 播客 needs audio AND a cover', async () => {
        await seedMedia();
        const video = makeConsole(happyState({ mode: '视频' }));
        const noVideo = await makeTransport(video).publish({ content: mediaContent({ operation: '视频' }) });
        expect(noVideo.ok).toBe(false);
        expect(noVideo.error).toContain('metadata.video is required');
        expect(video.closed).toHaveLength(0);

        const podcast = makeConsole(happyState({ mode: '播客' }));
        const noAudio = await makeTransport(podcast).publish({ content: mediaContent({ operation: '播客' }) });
        expect(noAudio.ok).toBe(false);
        expect(noAudio.error).toContain('metadata.audio is required');

        const noCover = await makeTransport(podcast).publish({
            content: mediaContent({ operation: '播客', audio }),
        });
        expect(noCover.ok).toBe(false);
        expect(noCover.error).toContain('metadata.coverImage is required');
        expect(podcast.closed).toHaveLength(0);
    });

    test('video artifacts are validated (absolute path, extension, existence)', async () => {
        const cases: Array<[string, string]> = [
            ['clip.mp4', 'must be absolute'],
            [join(tmpRoot, 'clip.avi'), 'unsupported extension'],
            [join(tmpRoot, 'ghost.mp4'), 'does not exist'],
        ];
        for (const [path, expected] of cases) {
            const console = makeConsole(happyState({ mode: '视频' }));
            const result = await makeTransport(console).publish({
                content: mediaContent({ operation: '视频', video: path }),
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain(expected);
            expect(console.closed).toHaveLength(0);
        }
    });

    test('sessionless preflight refuses fast with an ok:false non-blocking result', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const transport = makeTransport(console, {
            openPage: async () => {
                throw new Error('must not open a headed browser');
            },
            checkSession: async () => {
                throw new tsBrowserAutomation.BrowserProfileMissingError('/tmp/profile');
            },
        });
        const result = await transport.publish({ content: ARTICLE, options: { target: 'wechatmp' } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('profile-check.ts login');
        // Pre-browser refusal = effect none, so the bounded retry picks it up once logged in.
        expect(result.metadata?.itcDelivery).toEqual({ schemaVersion: 1, effect: 'none' });
    });

    test('preflight error other than missing profile names the failure', async () => {
        await seedMedia();
        const transport = makeTransport(makeConsole(happyState()), {
            openPage: async () => {
                throw new Error('must not open');
            },
            checkSession: async () => {
                throw new Error('timeout waiting for /cgi-bin/home');
            },
        });
        const result = await transport.publish({ content: ARTICLE, options: { target: 'wechatmp' } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('timeout waiting');
        expect(result.metadata?.itcDelivery).toEqual({ schemaVersion: 1, effect: 'none' });
    });

    test('a console that never reads ready fails loud with the profile dir', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ entryUrl: 'https://mp.weixin.qq.com/other' }));
        const result = await makeTransport(console, { consoleReadyTimeoutMs: 30 }).publish({ content: ARTICLE });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no authenticated wechatmp console');
        expect(console.closed).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Per-mode flows
// ---------------------------------------------------------------------------

describe('wechatmp-pub per-mode draft flows (fake console)', () => {
    test('draft receipt redacts the console session token', async () => {
        await seedMedia();
        const result = await makeTransport(makeConsole(happyState())).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        expect(JSON.stringify(result)).not.toContain(TOKEN);
    });

    test('session failure evidence redacts query credentials', async () => {
        await seedMedia();
        const result = await makeTransport(makeConsole(happyState()), {
            checkSession: async () => {
                throw new Error('https://mp.weixin.qq.com/?token=SENTINEL-SESSION-SECRET&lang=zh_CN');
            },
        }).publish({ content: ARTICLE });
        expect(result.ok).toBe(false);
        expect(JSON.stringify(result)).not.toContain('SENTINEL-SESSION-SECRET');
    });

    test('library cover opens the chooser menu before selecting its library source', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ coverDirectEntryTrap: true }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        expect(result.metadata?.warnings).toBeUndefined();
    });

    test('library cover continues when the opener directly shows the image chooser', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ coverOpensLibraryDirectly: true }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        expect(result.metadata?.warnings).toBeUndefined();
    });
    test('文章 commits the measured full-page layout preview before continuing composition', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ layoutPreview: true }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        expect(console.layoutOpened()).toBe(false);
        expect(selectorsOf(console.calls.editor, 'click').some((selector) => selector.includes('使用此排版'))).toBe(
            true,
        );
        expect(result.metadata?.warnings).toBeUndefined();
    }, 10000);

    test('文章 follows the separate layout preview tab and commits it before returning to the editor', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ layoutPreview: true, layoutNewTab: true }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        expect(console.layoutOpened()).toBe(false);
        expect(result.metadata?.warnings).toBeUndefined();
    }, 10000);

    test('文章 uses the native layout menu, waits for its delayed auto-save, and runs it after 原文链接', async () => {
        await seedMedia();
        const originalUrl = 'https://surfing.salty.vip/zh/posts/layout-readiness';
        const console = makeConsole(
            happyState({
                layoutNativeMenu: true,
                layoutAckDelayMs: 100,
            }),
        );
        const result = await makeTransport(console, {
            stepTimeoutMs: 1_000,
            draftTimeoutMs: 500,
            pollMs: 5,
        }).publish({
            content: {
                ...ARTICLE,
                metadata: { ...ARTICLE.metadata, wechatmp: { coverPath: bodyImage, originalUrl } },
            },
        });

        expect(result.ok).toBe(true);
        expect(console.layoutApplied()).toBe(true);
        const targetIndex = console.calls.editor.findIndex(
            (call) => call.op === 'evaluate' && String(call.args[0]).includes('__KK_WECHAT_LAYOUT_TARGET__'),
        );
        const layoutStateIndex = console.calls.editor.findIndex(
            (call) => call.op === 'evaluate' && String(call.args[0]).includes('__KK_WECHAT_LAYOUT_SAVE_STATE__'),
        );
        const saveIndex = console.calls.editor.findIndex(
            (call) => call.op === 'click' && isSaveBar(String(call.args[0])),
        );
        const originalUrlIndex = console.calls.editor.findIndex(
            (call) => call.op === 'fill' && String(call.args[1]) === originalUrl,
        );
        expect(originalUrlIndex).toBeGreaterThan(-1);
        expect(targetIndex).toBeGreaterThan(originalUrlIndex);
        expect(layoutStateIndex).toBeGreaterThan(targetIndex);
        expect(saveIndex).toBeGreaterThan(layoutStateIndex);
    }, 10000);

    test('文章: 一键排版 匹配目标格式 is ambiguous in native menu throws', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ layoutNativeMenu: true, layoutNativeAmbiguous: true }));
        const result = await makeTransport(console, { stepTimeoutMs: 100, pollMs: 5 }).publish({ content: ARTICLE });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('一键排版: 匹配目标格式 was ambiguous');
    });

    test('文章: 一键排版 native auto-save times out', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ layoutNativeMenu: true, layoutNativeSaveNever: true }));
        const result = await makeTransport(console, { stepTimeoutMs: 50, pollMs: 5 }).publish({ content: ARTICLE });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('native auto-save did not transition');
    });

    test('文章 saves the draft with a layout warning when the preview commits nothing', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ layoutPreview: true, layoutCommitRefused: true }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        // Measured 2026-11-12: the layout preview is its OWN tab (articlestruct) and the body is
        // already pasted as HTML, so a preview that commits nothing costs formatting, not the post.
        // The run still saves and carries the warning; nothing claims the layout was applied.
        expect(result.ok).toBe(true);
        expect(String(result.metadata?.warnings)).toContain('一键排版');
        expect(selectorsOf(console.calls.editor, 'click').some(isSaveBar)).toBe(true);
    }, 10000);

    test('文章: body images, title block, pasted body + 一键排版, 摘要, 作者, cover from body, observed save', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({ content: ARTICLE });

        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(result.metadata?.driver).toBe('script');
        expect(result.metadata?.operation).toBe('文章');
        expect(result.metadata?.entryPath).toBe('menu');
        expect(result.metadata?.editorCreateType).toBe(0);
        expect(result.metadata?.coverPath).toBe(bodyImage);
        expect(result.metadata?.artifactPaths).toEqual([bodyImage]);
        expect(result.metadata?.draftSignal).toBe(`草稿箱:${FRESH_STAMP}`);
        expect(result.metadata?.draftAttempts).toBe(1);
        expect(result.metadata?.titlePath).toBe('mirror-agreed');
        expect(result.metadata?.warnings).toBeUndefined();
        expect(String(result.metadata?.profileDir)).toContain('wechatmp');
        expect(console.layoutOpened()).toBe(true);
        expect(result.message).toContain('文章 draft saved (unpublished)');
        expect(console.closed).toHaveLength(1);

        const editor = console.calls.editor;
        // The body went in through the shared paste helper, never an innerHTML value set (W1).
        const pasted = editor.filter(
            (call) => call.op === 'evaluate' && String(call.args[0]).includes('ClipboardEvent'),
        );
        expect(pasted).toHaveLength(1);
        expect(selectorsOf(editor, 'setInputFiles')).toEqual(['input[type="file"][accept*="image/"]']);
        expect(selectorsOf(editor, 'type')).toContain('div.ProseMirror[data-placeholder^="请在这里输入标题"]');
        // 一键排版 → 匹配目标格式 (discovery §5.3).
        const layoutIndex = editor.findIndex((call) => call.op === 'click' && isLayoutControl(String(call.args[0])));
        expect(layoutIndex).toBeGreaterThan(-1);
        const layoutTargetIndex = editor.findIndex(
            (call) => call.op === 'click' && isLayoutTarget(String(call.args[0])),
        );
        expect(layoutTargetIndex).toBeGreaterThan(layoutIndex);
        // A draft run never touches a publish control.
        expect(selectorsOf(editor, 'click').some(isPublishControl)).toBe(false);
    });

    test('贴图: images only, optional title, observed save', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ mode: '贴图', createType: 8 }));
        const images = [join(tmpRoot, 'sticker-a.png'), join(tmpRoot, 'sticker-b.png')];
        await Promise.all(images.map((path) => writeFile(path, 'png')));
        const content = mediaContent({ operation: '贴图', images: images.map((path) => ({ path })) }, { title: '' });
        const result = await makeTransport(console).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.metadata?.operation).toBe('贴图');
        expect(result.metadata?.artifactPaths).toEqual(images);
        expect(result.metadata?.titlePath).toBe('absent');
        const editor = console.calls.editor;
        const upload = editor.find((call) => call.op === 'setInputFiles');
        expect(upload?.args[1]).toEqual(images);
        // No title block typing and no layout step for an untitled 贴图.
        expect(selectorsOf(editor, 'type')).toHaveLength(0);
        expect(selectorsOf(editor, 'click').some(isLayoutControl)).toBe(false);
    });

    test('视频: 本地上传 → file → 确定, then the artifact-gated save bar and the title', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ mode: '视频', createType: 5 }));
        const content = mediaContent({ operation: '视频', video });
        const result = await makeTransport(console).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.metadata?.operation).toBe('视频');
        expect(result.metadata?.editorCreateType).toBe(5);
        const editor = console.calls.editor;
        const upload = editor.find((call) => call.op === 'setInputFiles');
        expect(upload?.args[1]).toEqual([video]);
        const uploadIndex = editor.findIndex((call) => call.op === 'setInputFiles');
        const openIndex = editor.findIndex((call) => call.op === 'click' && isVideoUpload(String(call.args[0])));
        const confirmIndex = editor.findIndex((call) => call.op === 'click' && isConfirm(String(call.args[0])));
        const saveIndex = editor.findIndex((call) => call.op === 'click' && isSaveBar(String(call.args[0])));
        // 本地上传 → file → 确定, and only then does the save bar exist (§5.1).
        expect(openIndex).toBeGreaterThan(-1);
        expect(uploadIndex).toBeGreaterThan(openIndex);
        expect(confirmIndex).toBeGreaterThan(uploadIndex);
        expect(saveIndex).toBeGreaterThan(confirmIndex);
    });

    test('播客: 上传音频 → audio + cover → 插入, then the save bar and the title', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ mode: '播客', createType: 7 }));
        const content = mediaContent({ operation: '播客', audio, coverImage: cover });
        const result = await makeTransport(console).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.metadata?.operation).toBe('播客');
        expect(result.metadata?.artifactPaths).toEqual([audio, cover]);
        expect(result.metadata?.editorCreateType).toBe(7);
        const editor = console.calls.editor;
        const files = editor.filter((call) => call.op === 'setInputFiles').map((call) => call.args[1]);
        expect(files).toEqual([[audio], [cover]]);
        expect(selectorsOf(editor, 'click').some(isPodcastInsert)).toBe(true);
        expect(selectorsOf(editor, 'click').some(isSaveBar)).toBe(true);
    });

    test('播客: 复用已有素材库素材 → 插入', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ mode: '播客', createType: 7, podcastReuse: true }));
        const content = mediaContent(
            { operation: '播客', audio, coverImage: cover },
            { title: '播客标题', body: '正文' },
        );
        const result = await makeTransport(console).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.metadata?.operation).toBe('播客');
        expect(result.metadata?.editorCreateType).toBe(7);
        const editor = console.calls.editor;
        const files = editor.filter((call) => call.op === 'setInputFiles');
        expect(files).toHaveLength(0);
        expect(selectorsOf(editor, 'click').some(isPodcastInsert)).toBe(true);
        expect(selectorsOf(editor, 'click').some(isSaveBar)).toBe(true);
    });

    test('an unobserved draft signal is a loud ok:false naming the control and the signal', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ saveMovesStamp: false }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
        expect(result.error).toContain('保存为草稿');
        expect(result.error).toContain('更新于');
        expect(result.error).toContain('草稿箱');
        expect(console.closed).toHaveLength(1);
    });

    test('a stale 草稿箱 row is not evidence: the stamp must be FRESH against the baseline', async () => {
        await seedMedia();
        // A row for this title already exists (MP auto-saves continuously) and a save does not move
        // it: the flow must not report success off a stamp it read before the editor ever opened.
        const console = makeConsole(happyState({ draftStamp: STALE_STAMP, saveMovesStamp: false }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(`before=${STALE_STAMP}`);
        expect(result.error).toContain(`after=${STALE_STAMP}`);
    });

    test('a stale row that the save refreshes is the observed signal', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ draftStamp: STALE_STAMP, saveMovesStamp: true }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        expect(result.metadata?.draftStampBefore).toBe(STALE_STAMP);
        expect(result.metadata?.draftStampAfter).toBe(FRESH_STAMP);
    });

    test('the save click is retried, and the retry count is reported', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ saveMovesStamp: false }));
        // stepTimeoutMs is waited out twice on this failure path, so keep the budget small: the test
        // asserts the retry COUNT, and 300ms x2 put it within 2.5x of bun's 5s default on CI (it timed
        // out at 5003ms on run 37420975363 while passing at 2008ms locally).
        const result = await makeTransport(console, { submitAttempts: 2, stepTimeoutMs: 75 }).publish({
            content: ARTICLE,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('clicked 2×');
        expect(selectorsOf(console.calls.editor, 'click').filter(isSaveBar)).toHaveLength(2);
    });

    // The public path is exercised ONLY against the fake console: `发表` is a recorded call on a
    // plain object, never a real click, and no verification/dogfood run activates it (ADR-022).
    test('public: 贴图 keeps the direct publish flow and does not require the article save acknowledgement', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({ mode: '贴图', createType: 8, publicSaveAckFailure: true, publish: 'sent' }),
        );
        const result = await makeTransport(console).publish({
            content: mediaContent(
                { operation: '贴图', images: [{ path: bodyImage }], publishStatus: 'public' },
                { title: '公开贴图', body: '正文' },
            ),
        });

        expect(result.ok).toBe(true);
        expect(console.calls.editor.some((call) => call.op === 'saveDraftAndWait')).toBe(false);
        expect(selectorsOf(console.calls.editor, 'click').filter(isSaveBar)).toHaveLength(0);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishControl)).toHaveLength(1);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: 视频 keeps the direct publish flow and does not require the article save acknowledgement', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({ mode: '视频', createType: 5, publicSaveAckFailure: true, publish: 'sent' }),
        );
        const result = await makeTransport(console).publish({
            content: mediaContent(
                { operation: '视频', video, publishStatus: 'public' },
                { title: '公开视频', body: '正文' },
            ),
        });

        expect(result.ok).toBe(true);
        expect(console.calls.editor.some((call) => call.op === 'saveDraftAndWait')).toBe(false);
        expect(selectorsOf(console.calls.editor, 'click').filter(isSaveBar)).toHaveLength(0);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishControl)).toHaveLength(1);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: 播客 keeps the direct publish flow and does not require the article save acknowledgement', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({ mode: '播客', createType: 7, publicSaveAckFailure: true, publish: 'sent' }),
        );
        const result = await makeTransport(console).publish({
            content: mediaContent(
                { operation: '播客', audio, coverImage: cover, publishStatus: 'public' },
                { title: '公开播客', body: '正文' },
            ),
        });

        expect(result.ok).toBe(true);
        expect(console.calls.editor.some((call) => call.op === 'saveDraftAndWait')).toBe(false);
        expect(selectorsOf(console.calls.editor, 'click').filter(isSaveBar)).toHaveLength(0);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishControl)).toHaveLength(1);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: only an explicit publishStatus reaches 发表, and the platform refusal is relayed', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publish: 'refused' }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('publish refused by wechatmp');
        expect(result.error).toContain('内容不完整，无法发表');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.some(isPublishControl)).toBe(true);
        expect(clicks.some(isSaveBar)).toBe(true);
    });

    test('public: an observed success marker reports the live signal', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publish: 'sent' }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.metadata?.publishSignal).toContain('sent:');
        expect(result.metadata?.publishControl).toContain('mass_send');
        const editor = console.calls.editor;
        const saveIndex = editor.findIndex((call) => call.op === 'click' && isSaveBar(String(call.args[0])));
        const reopenIndex = editor.findIndex(
            (call) => call.op === 'goto' && String(call.args[0]).includes('appmsgid=100001161'),
        );
        const publishIndex = editor.findIndex((call) => call.op === 'click' && isPublishControl(String(call.args[0])));
        expect(saveIndex).toBeGreaterThan(-1);
        expect(reopenIndex).toBeGreaterThan(saveIndex);
        expect(publishIndex).toBeGreaterThan(reopenIndex);
        expect(result.metadata?.savedEditorUrl).toContain('appmsgid=100001161');
        expect(result.metadata?.savedEditorUrl).not.toContain(`token=${TOKEN}`);
    });

    test('public: canonical saved-editor receipts redact every known session query credential', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publish: 'sent',
                publicSaveUrl: `${savedEditorUrlFor(0).replace(`token=${TOKEN}`, 'token=SENTINEL-TOKEN')}&ticket=SENTINEL-TICKET&authkey=SENTINEL-AUTHKEY`,
            }),
        );
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        expect(JSON.stringify(result)).not.toContain('SENTINEL-TOKEN');
        expect(JSON.stringify(result)).not.toContain('SENTINEL-TICKET');
        expect(JSON.stringify(result)).not.toContain('SENTINEL-AUTHKEY');
    });

    test('public: default confirmation keeps 群发通知 unchanged and clicks the scoped final 发表 once', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publish: 'sent' }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.filter(isPublishControl)).toHaveLength(1);
        expect(clicks.filter(isPublishNotifyToggle)).toHaveLength(0);
        expect(clicks.filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: default confirmation preserves an already-off switch and records the observed state separately', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publish: 'sent', publicNotifySubscribers: false }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        expect(result.metadata?.notifySubscribers).toBe(false);
        expect(result.metadata?.notifySubscribersPolicy).toBe('preserve');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.filter(isPublishNotifyToggle)).toHaveLength(0);
        expect(clicks.filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: explicit notifySubscribers false turns 群发通知 off before the final 发表 click', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publish: 'sent' }));
        const result = await makeTransport(console).publish({
            content: {
                ...ARTICLE,
                metadata: {
                    ...ARTICLE.metadata,
                    publishStatus: 'public',
                    wechatmp: { coverPath: bodyImage, notifySubscribers: false },
                },
            },
        });

        expect(result.ok).toBe(true);
        expect(result.metadata?.notifySubscribers).toBe(false);
        expect(result.metadata?.notifySubscribersPolicy).toBe('disabled');
        const clicks = selectorsOf(console.calls.editor, 'click');
        const toggleIndex = clicks.findIndex(isPublishNotifyToggle);
        const finalIndex = clicks.findIndex(isPublishFinal);
        expect(clicks.filter(isPublishNotifyToggle)).toHaveLength(1);
        expect(finalIndex).toBeGreaterThan(toggleIndex);
        expect(clicks.filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: explicit notifySubscribers false accepts an already-off uniquely observed switch without reclicking it', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publish: 'sent', publicNotifySubscribers: false }));
        const result = await makeTransport(console).publish({
            content: {
                ...ARTICLE,
                metadata: {
                    ...ARTICLE.metadata,
                    publishStatus: 'public',
                    wechatmp: { coverPath: bodyImage, notifySubscribers: false },
                },
            },
        });

        expect(result.ok).toBe(true);
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.filter(isPublishNotifyToggle)).toHaveLength(0);
        expect(clicks.filter(isPublishFinal)).toHaveLength(1);
    });

    test.each([
        ['missing', 'unavailable'],
        ['ambiguous', 'ambiguous'],
    ] as const)(
        'public: explicit notifySubscribers false fails closed when the 群发通知 switch is %s',
        async (toggle, reason) => {
            await seedMedia();
            const console = makeConsole(publicState({ publish: 'sent', publicNotifyToggle: toggle }));
            const result = await makeTransport(console).publish({
                content: {
                    ...ARTICLE,
                    metadata: {
                        ...ARTICLE.metadata,
                        publishStatus: 'public',
                        wechatmp: { coverPath: bodyImage, notifySubscribers: false },
                    },
                },
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('群发通知');
            expect(result.error).toContain(reason);
            const clicks = selectorsOf(console.calls.editor, 'click');
            expect(clicks.filter(isPublishFinal)).toHaveLength(0);
        },
    );

    test('public: a pre-existing canonical URL waits through partial reload hydration before publication', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicInitialUrl: savedEditorUrlFor(0),
                publicReloadSnapshots: [
                    { title: '', body: '', media: [], cover: '' },
                    { title: '', body: '', media: [], cover: '' },
                    undefined,
                ],
            }),
        );
        const result = await makeTransport(console, { draftTimeoutMs: 500 }).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.draftSaveSignal).toBe('persisted-snapshot');
        const reloads = console.calls.editor.filter(
            (call) => call.op === 'goto' && String(call.args[0]).includes('appmsgid=100001161'),
        );
        const snapshots = console.calls.editor.filter(
            (call) => call.op === 'evaluate' && String(call.args[0]).includes('__KK_WECHAT_PUBLISH_SNAPSHOT__'),
        );
        expect(snapshots.length).toBeGreaterThanOrEqual(2);
        expect(reloads.length).toBeGreaterThanOrEqual(2);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishControl)).toHaveLength(1);
    });

    test('public: a pre-existing canonical URL waits for the native save acknowledgement before reloading', async () => {
        await seedMedia();
        const savedUrl = savedEditorUrlFor(0);
        const console = makeConsole(
            publicState({
                publicInitialUrl: savedUrl,
                // Keep the explicit response comfortably beyond the flow's post-ack settle
                // window so an old auto-save completion cannot accidentally make the fixture green.
                publicSaveAckDelayMs: 100,
                publicPostReloadSavingPolls: 2,
                publicPendingReloadSnapshot: { media: ['old-image'], cover: 'url("")' },
            }),
        );
        const result = await makeTransport(console, { draftTimeoutMs: 500, pollMs: 5 }).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        const ackStartIndex = console.calls.editor.findIndex((call) => call.op === 'saveDraftAndWait');
        const ackCompleteIndex = console.calls.editor.findIndex((call) => call.op === 'saveDraftAck');
        const reloadIndex = console.calls.editor.findIndex((call) => call.op === 'goto' && call.args[0] === savedUrl);
        expect(ackStartIndex).toBeGreaterThan(-1);
        expect(ackCompleteIndex).toBeGreaterThan(ackStartIndex);
        expect(reloadIndex).toBeGreaterThan(ackCompleteIndex);
        const autoSaveStateIndices = console.calls.editor
            .map((call, index) => ({ call, index }))
            .filter(
                ({ call }) =>
                    call.op === 'evaluate' && String(call.args[0]).includes('__KK_WECHAT_LAYOUT_SAVE_STATE__'),
            )
            .map(({ index }) => index);
        const publishIndex = console.calls.editor.findIndex(
            (call) => call.op === 'click' && isPublishControl(String(call.args[0])),
        );
        expect(autoSaveStateIndices.length).toBeGreaterThanOrEqual(3);
        expect(publishIndex).toBeGreaterThan(autoSaveStateIndices[autoSaveStateIndices.length - 1] ?? -1);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: a matching canonical snapshot does not publish while native autosave is still saving', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicInitialUrl: savedEditorUrlFor(0),
                publicPostReloadSavingPolls: 99,
            }),
        );
        const result = await makeTransport(console, { stepTimeoutMs: 30, pollMs: 5 }).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('native 保存状态');
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishControl)).toHaveLength(0);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(0);
    });

    test('public: an already-idle canonical snapshot needs two quiet saved probes before publication', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicInitialUrl: savedEditorUrlFor(0),
                publicPostReloadSavingPolls: 0,
            }),
        );
        const result = await makeTransport(console, { pollMs: 5 }).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        const autoSaveStateIndices = console.calls.editor
            .map((call, index) => ({ call, index }))
            .filter(
                ({ call }) =>
                    call.op === 'evaluate' && String(call.args[0]).includes('__KK_WECHAT_LAYOUT_SAVE_STATE__'),
            )
            .map(({ index }) => index);
        const publishIndex = console.calls.editor.findIndex(
            (call) => call.op === 'click' && isPublishControl(String(call.args[0])),
        );
        expect(autoSaveStateIndices.length).toBeGreaterThanOrEqual(2);
        expect(publishIndex).toBeGreaterThan(autoSaveStateIndices[autoSaveStateIndices.length - 1] ?? -1);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: a recognized legacy editor readiness rail needs two manual-save probes before publication', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicInitialUrl: savedEditorUrlFor(0),
                publicLegacyEditor: true,
                publicPostReloadSavingPolls: 99,
                publicPostReloadLegacyReadyPolls: 1,
            }),
        );
        const result = await makeTransport(console, { pollMs: 5 }).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        const legacyReadyIndices = console.calls.editor
            .map((call, index) => ({ call, index }))
            .filter(
                ({ call }) =>
                    call.op === 'evaluate' && String(call.args[0]).includes('__KK_WECHAT_LEGACY_EDITOR_READY__'),
            )
            .map(({ index }) => index);
        const publishIndex = console.calls.editor.findIndex(
            (call) => call.op === 'click' && isPublishControl(String(call.args[0])),
        );
        expect(legacyReadyIndices.length).toBeGreaterThanOrEqual(3);
        expect(publishIndex).toBeGreaterThan(legacyReadyIndices[legacyReadyIndices.length - 1] ?? -1);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: an unrecognized legacy-editor readiness state never counts as saved', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicInitialUrl: savedEditorUrlFor(0),
                publicLegacyEditor: true,
                publicPostReloadSavingPolls: 99,
                publicPostReloadLegacyReadyPolls: 99,
            }),
        );
        const result = await makeTransport(console, { stepTimeoutMs: 30, pollMs: 5 }).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('native 保存状态');
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishControl)).toHaveLength(0);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(0);
    });

    test('public: a native save acknowledgement failure stops before canonical reload and publication', async () => {
        await seedMedia();
        const savedUrl = savedEditorUrlFor(0);
        const console = makeConsole(
            publicState({
                publicInitialUrl: savedUrl,
                publicSaveAckFailure: true,
            }),
        );
        const result = await makeTransport(console, { draftTimeoutMs: 100, pollMs: 5 }).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('native 保存为草稿 was not acknowledged successfully');
        expect(console.calls.editor.some((call) => call.op === 'saveDraftAck')).toBe(false);
        expect(console.calls.editor.some((call) => call.op === 'goto' && call.args[0] === savedUrl)).toBe(false);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishControl)).toHaveLength(0);
    });

    test('public: canonical reloads remain read-only until a longer media hydration gap resolves', async () => {
        await seedMedia();
        const partial = { title: '', body: '', media: [], cover: '' };
        const console = makeConsole(
            publicState({
                publicInitialUrl: savedEditorUrlFor(0),
                publicReloadSnapshots: [partial, partial, partial, partial, undefined],
            }),
        );
        const result = await makeTransport(console, { draftTimeoutMs: 1_000 }).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        const reloads = console.calls.editor.filter(
            (call) => call.op === 'goto' && String(call.args[0]).includes('appmsgid=100001161'),
        );
        expect(reloads.length).toBeGreaterThanOrEqual(4);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: accepts WeChat CDN size re-encoding while preserving layout, original URL, and one publish click', async () => {
        await seedMedia();
        const cdnAsset = 'https://mmbiz.qpic.cn/sz_mmbiz_png/media-lineage/0?wx_fmt=png&from=appmsg';
        const resizedCdnAsset = cdnAsset.replace('/0?', '/640?');
        const originalUrl = 'https://surfing.salty.vip/zh/posts/20261102-ai-2026-11-02';
        const console = makeConsole(
            publicState({
                layoutPreview: true,
                publicComposedMedia: [cdnAsset],
                publicReloadSnapshot: { media: [resizedCdnAsset] },
            }),
        );
        const result = await makeTransport(console).publish({
            content: {
                ...ARTICLE,
                metadata: {
                    ...ARTICLE.metadata,
                    publishStatus: 'public',
                    wechatmp: { coverPath: bodyImage, originalUrl },
                },
            },
        });

        expect(result.ok).toBe(true);
        expect(console.layoutOpened()).toBe(false);
        expect(
            console.calls.editor.some(
                (call) =>
                    call.op === 'fill' && String(call.args[0]).includes('input.js_url') && call.args[1] === originalUrl,
            ),
        ).toBe(true);
        expect(selectorsOf(console.calls.editor, 'click').filter(isSaveBar)).toHaveLength(1);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: a changed original URL on the canonical reload refuses before publication', async () => {
        await seedMedia();
        const originalUrl = 'https://surfing.salty.vip/zh/posts/20261102-ai-2026-11-02';
        const console = makeConsole(
            publicState({
                publicReloadSnapshot: { originalUrl: '' },
            }),
        );
        const result = await makeTransport(console).publish({
            content: {
                ...ARTICLE,
                metadata: {
                    ...ARTICLE.metadata,
                    publishStatus: 'public',
                    wechatmp: { coverPath: bodyImage, originalUrl },
                },
            },
        });

        expect(result.ok).toBe(false);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishControl)).toHaveLength(0);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(0);
    });

    test('public: stale-version refusal after save is known and never reaches the publish control', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                draftStamp: STALE_STAMP,
                publicSaveUrl: undefined,
                publicSaveRefusal: '当前编辑的草稿不是最新版本',
            }),
        );
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('当前编辑的草稿不是最新版本');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.some(isSaveBar)).toBe(true);
        expect(clicks.some(isPublishControl)).toBe(false);
    });

    test('public: known preconfirmation stale refusal views the latest editor once and re-enters publish once', async () => {
        await seedMedia();
        const latestUrl = `${savedEditorUrlFor(0)}&data_seq=2`;
        const console = makeConsole(
            publicState({
                publicPreconfirmationRefusal: '当前编辑的草稿不是最新版本',
                publicLatestUrl: latestUrl,
            }),
        );
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        expect(result.metadata?.staleVersionRecoveryCount).toBe(1);
        expect(result.metadata?.savedEditorUrl).toContain('data_seq=2');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.filter(isPublishControl)).toHaveLength(2);
        expect(clicks.filter(isViewLatest)).toHaveLength(1);
        expect(clicks.filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: stale recovery waits while the latest editor body is still a hydrating prefix (20261104)', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicPreconfirmationRefusal: '当前编辑的草稿不是最新版本',
                publicLatestUrl: `${savedEditorUrlFor(0)}&data_seq=2`,
                publicLatestBodyPrefixReads: 3,
            }),
        );
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        expect(result.metadata?.staleVersionRecoveryCount).toBe(1);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(1);
    });

    test('public: changed latest editor content stops stale recovery before the final publish click', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicPreconfirmationRefusal: '当前编辑的草稿不是最新版本',
                publicLatestSnapshot: { body: 'latest changed body' },
            }),
        );
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('latest editor content mismatch');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.filter(isPublishControl)).toHaveLength(1);
        expect(clicks.filter(isViewLatest)).toHaveLength(1);
        expect(clicks.filter(isPublishFinal)).toHaveLength(0);
    });

    test('public: changed latest appmsg identity stops stale recovery before the final publish click', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicPreconfirmationRefusal: '当前编辑的草稿不是最新版本',
                publicLatestAppmsgId: '100009999',
            }),
        );
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('expected appmsgid=100001161');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.filter(isPublishControl)).toHaveLength(1);
        expect(clicks.filter(isViewLatest)).toHaveLength(1);
        expect(clicks.filter(isPublishFinal)).toHaveLength(0);
    });

    test('public: a second known stale refusal stops bounded recovery without a final click', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicPreconfirmationRefusal: '当前编辑的草稿不是最新版本',
                publicPreconfirmationSecondRefusal: '当前编辑的草稿不是最新版本',
            }),
        );
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('当前编辑的草稿不是最新版本');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.filter(isPublishControl)).toHaveLength(2);
        expect(clicks.filter(isViewLatest)).toHaveLength(1);
        expect(clicks.filter(isPublishFinal)).toHaveLength(0);
    });

    test('public: a 查看新草稿 click that leaves the stale refusal visible never retries the initial publish control', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicPreconfirmationRefusal: '当前编辑的草稿不是最新版本',
                publicLatestViewNoEffect: true,
            }),
        );
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('canonical saved editor route');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.filter(isPublishControl)).toHaveLength(1);
        expect(clicks.filter(isViewLatest)).toHaveLength(1);
        expect(clicks.filter(isPublishFinal)).toHaveLength(0);
    });

    test('public: a mass-send dialog that mounts after 5s is still confirmed, not reported missing', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publicDialogDelayMs: 5_200 }));
        const result = await makeTransport(console, { stepTimeoutMs: 30_000 }).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.error ?? '').not.toContain('发表 dialog was missing');
        expect(result.ok).toBe(true);
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishFinal)).toHaveLength(1);
    }, 20_000);

    test('public: an unknown preconfirmation outcome never retries or opens 查看新草稿', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publicPreconfirmationUnknown: true }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('no final publish click attempted');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.filter(isPublishControl)).toHaveLength(1);
        expect(clicks.filter(isViewLatest)).toHaveLength(0);
        expect(clicks.filter(isPublishFinal)).toHaveLength(0);
    });

    test('public: a save without the native canonical URL signal stops before publication', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publicSaveUrl: undefined }));
        const result = await makeTransport(console, {
            draftTimeoutMs: 10,
            pollMs: 1,
            submitSettleMs: 0,
            stepTimeoutMs: 100,
        }).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('action=edit with appmsgid');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.some(isSaveBar)).toBe(true);
        expect(clicks.some(isPublishControl)).toBe(false);
    });

    test('public: a changed persisted snapshot refuses before publication', async () => {
        await seedMedia();
        const console = makeConsole(
            publicState({
                publicReloadSnapshot: {
                    title: 'changed after save',
                    body: 'different persisted body',
                    media: ['different-media'],
                    cover: 'different-cover',
                },
            }),
        );
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('saved editor content mismatch');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.some(isSaveBar)).toBe(true);
        expect(clicks.some(isPublishControl)).toBe(false);
    });

    test('public: an unobserved outcome fails loud with the duplicate-publish warning', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publish: 'silent' }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('state unknown');
        expect(result.error).toContain('could publish twice');
        expect(selectorsOf(console.calls.editor, 'click').filter(isPublishControl)).toHaveLength(1);
    });

    test('public: failed submission retains cover composition diagnostics', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publish: 'silent', coverLibraryMissing: true }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('compose diagnostics:');
        expect(result.error).toContain('cover:');
    });

    test('public: measured missing-image validation is a known refusal, never unknown delivery', async () => {
        await seedMedia();
        const console = makeConsole(publicState({ publish: 'missing-cover' }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('publish refused by wechatmp: 必须插入一张图片');
        expect(result.error).not.toContain('state unknown');
    });
});

// ---------------------------------------------------------------------------
// The measured traps: the new-tab editor, the title mirror, and signal scoping
// ---------------------------------------------------------------------------

describe('wechatmp-pub measured traps (discovery §1, §5.1, §5.2)', () => {
    test('the editor opens in a NEW TAB: every editor step acts on the second page', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({ content: ARTICLE });

        expect(result.ok).toBe(true);
        expect(console.editorPage()).not.toBeNull();
        // Nothing was typed or pasted on the entry page — it stays on the console home (W3).
        expect(opsOf(console.calls.entry)).not.toContain('type');
        expect(selectorsOf(console.calls.entry, 'setInputFiles')).toHaveLength(0);
        expect(selectorsOf(console.calls.entry, 'click').some(isSaveBar)).toBe(false);
        // The entry page's only jobs: the creation menu, and the 草稿箱 reads.
        expect(selectorsOf(console.calls.entry, 'click').some((selector) => menuItemLabel(selector) === '文章')).toBe(
            true,
        );
        expect(selectorsOf(console.calls.editor, 'type')).toContain(
            'div.ProseMirror[data-placeholder^="请在这里输入标题"]',
        );
    });

    test('a closed creation menu is opened from the console 新的创作 control first', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ menuClosed: true }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        expect(result.metadata?.entryPath).toBe('menu');
        const clicks = selectorsOf(console.calls.entry, 'click');
        expect(clicks.some(isMenuOpener)).toBe(true);
        expect(clicks.some((selector) => menuItemLabel(selector) === '文章')).toBe(true);
    });

    test('a console that does not open a tab falls back to the token-derived editor route', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ menu: [], tokenLink: null }));
        const result = await makeTransport(console).publish({ content: ARTICLE });

        expect(result.ok).toBe(true);
        expect(result.metadata?.entryPath).toBe('route');
        const editorGotos = console.calls.editor.filter((call) => call.op === 'goto');
        expect(editorGotos).toHaveLength(1);
        const route = String(editorGotos[0]?.args[0]);
        expect(route).toContain('t=media/appmsg_edit_v2');
        expect(route).toContain('createType=0');
        expect(route).toContain(`token=${TOKEN}`);
        // The timestamp is generated per run, never baked into the template.
        const timestamp = Number(/[?&]timestamp=(\d+)/.exec(route)?.[1]);
        expect(Number.isFinite(timestamp)).toBe(true);
        expect(Date.now() - timestamp).toBeLessThan(60_000);
        expect(readCreateType(route)).toBe(0);
    });

    test('the token can come from a console link when the home URL carries none', async () => {
        await seedMedia();
        const console = makeConsole(
            happyState({
                entryUrl: 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN',
                menu: [],
                tokenLink: TOKEN,
            }),
        );
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        expect(String(console.calls.editor.find((call) => call.op === 'goto')?.args[0])).toContain(`token=${TOKEN}`);
    });

    test('a console without any token source fails loud instead of guessing a route', async () => {
        await seedMedia();
        const console = makeConsole(
            happyState({
                entryUrl: 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN',
                menu: [],
                tokenLink: null,
            }),
        );
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no session token to derive its route');
    });

    test('an editor that lands on another createType is refused, not typed into', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ createType: 8 }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('landed on createType=8');
        expect(result.error).toContain('createType=0');
        expect(selectorsOf(console.calls.editor, 'type')).toHaveLength(0);
    });

    test('typing the title block sets the hidden mirror — the flow never fills the mirror alone', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({ content: ARTICLE });

        expect(result.ok).toBe(true);
        expect(result.metadata?.titlePath).toBe('mirror-agreed');
        const editor = console.calls.editor;
        expect(selectorsOf(editor, 'type')).toEqual(['div.ProseMirror[data-placeholder^="请在这里输入标题"]']);
        // Filling the mirror is the trap: it saves a draft with an EMPTY title (discovery §5.2).
        expect(editor.some((call) => call.op === 'fill' && isMirror(String(call.args[0])))).toBe(false);
    });

    test('a mirror that does not follow the typed title fails loud instead of saving an untitled draft', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ mirrorFollows: false }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('textarea#title');
        expect(result.error).toContain('trap 1');
        expect(selectorsOf(console.calls.editor, 'click').some(isSaveBar)).toBe(false);
    });

    test('the draft signal is scoped: the editor body never satisfies the 草稿箱 probe', async () => {
        await seedMedia();
        // The body carries the signal label and the draft box shows no fresh row: an unscoped
        // `:text(更新于)` probe would report a saved draft the console never showed.
        const console = makeConsole(happyState({ saveMovesStamp: false }));
        const content = { ...ARTICLE, body: '正文里写着 更新于 13:12 的字样' };
        const result = await makeTransport(console).publish({ content });

        expect(result.ok).toBe(false);
        const probes = selectorsOf(console.calls.entry, 'locator').filter(isStampProbe);
        expect(probes.length).toBeGreaterThan(0);
        for (const probe of probes) {
            // Every read is container-qualified and keyed to this run's title — never a bare
            // `:text(…)`, which the pasted body would satisfy.
            expect(probe).toContain(':text("更新于")');
            expect(probe).toMatch(/\S:has-text\("每日 AI 资讯/);
            expect(probe.startsWith(':text(')).toBe(false);
        }
        // Nothing on the editor page was asked for the signal.
        expect(selectorsOf(console.calls.editor, 'locator').filter(isStampProbe)).toHaveLength(0);
    });

    test('the 草稿箱 read happens on the console home, after re-reading it', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        // One baseline read before the editor opens, plus at least one reload+read after the save.
        const gotos = console.calls.entry.filter((call) => call.op === 'goto');
        expect(gotos.length).toBeGreaterThanOrEqual(1);
        expect(String(gotos[gotos.length - 1]?.args[0])).toContain('token=');
        // 20261005: the 草稿箱 cards live on the console HOME; the appmsg list route the 草稿箱 entry
        // links to renders none of them (authenticated probe), so a read there always missed.
        expect(String(gotos[gotos.length - 1]?.args[0])).toContain('t=home/index');
    });
});

// ---------------------------------------------------------------------------
// The channel-level metadata-enrichment rail (metadata.wechatmp)
// ---------------------------------------------------------------------------

/** Scripted failures for the enrichment rail's warning paths. */
interface RecordingOpts {
    /** Selector fragment whose click rejects — the step retry + warning path. */
    failOn?: string;
    /** 0260: selector fragment(s) that render no row control (openRow exhausts and throws). */
    missingOn?: string | string[];
    /** 0272: model the 赏-blocked account (the dialog renders 前往开通). Default: functional. */
    rewardBlocked?: boolean;
    /**
     * 2026-11-20 measured shape: the account has no authorized 赞赏 account, so the row itself carries
     * `无法开启赞赏，因为还没有赞赏账户授权给本公众号` and a 0×0 box. Distinct from `rewardBlocked`, which is
     * the older "the dialog, once open, offers only 前往开通" shape.
     */
    rewardRowBlocked?: boolean;
    /** 0260: the committed value a locator input readback returns (原文链接 committed URL). */
    inputValue?: string | ((selector: string) => string);
    /** 0260: selector fragment(s) whose locator input readback REJECTS (production wrappers can). */
    inputValueFailsOn?: string | string[];
}

/** A seam-shaped recording page for the enrichment unit tests. */
function recordingPage(ops: string[], evalReturns: unknown[] = [], opts: RecordingOpts = {}): WechatPage {
    let urlCommitted = false;
    const broken = (selector: string) => opts.failOn !== undefined && selector.includes(opts.failOn);
    const missing = (selector: string) =>
        selector.includes('选择图片') ||
        (Array.isArray(opts.missingOn) ? opts.missingOn : [opts.missingOn ?? '']).some(
            (fragment) => fragment !== '' && selector.includes(fragment),
        );
    const readbackBroken = (selector: string) =>
        (Array.isArray(opts.inputValueFailsOn) ? opts.inputValueFailsOn : [opts.inputValueFailsOn ?? '']).some(
            (fragment) => fragment !== '' && selector.includes(fragment),
        );
    return {
        goto: async () => undefined,
        url: () => editorUrlFor(0),
        locator: (selector) => ({
            // 0272: the 赏-blocked prerequisite only renders on blocked accounts; default fake = functional.
            // 0260: missingOn models an account whose settings row is entirely absent.
            count: async () =>
                selector.includes('前往开通') || selector.includes('无法开启')
                    ? opts.rewardBlocked === true
                        ? 1
                        : 0
                    : missing(selector)
                      ? 0
                      : 1,
            first: () => ({
                count: async () =>
                    selector.includes('前往开通') || selector.includes('无法开启')
                        ? opts.rewardBlocked === true
                            ? 1
                            : 0
                        : missing(selector)
                          ? 0
                          : 1,
                isVisible: async () => true,
                fill: async (text) => {
                    if (broken(selector)) throw new Error('detached row');
                    ops.push(`fill ${selector} = ${text}`);
                },
                click: async () => {
                    if (broken(selector)) throw new Error('detached row');
                    ops.push(`click ${selector}`);
                    if (selector.includes('a.jsPopoverBt:text-is("确定")')) urlCommitted = true;
                },
                type: async (text) => {
                    ops.push(`type ${selector} = ${text}`);
                },
                waitFor: async () => {
                    ops.push(`wait ${selector}`);
                },
                textContent: async () => '',
                inputValue: async () => {
                    if (readbackBroken(selector)) throw new Error('committed readback refused');
                    return typeof opts.inputValue === 'function' ? opts.inputValue(selector) : (opts.inputValue ?? '');
                },
            }),
        }),
        setInputFiles: async (selector) => {
            ops.push(`files ${selector}`);
        },
        evaluate: async (expression) => {
            // The 赞赏 row-state read (measured 2026-11-20) answers from the state and never consumes a
            // scripted return: it is a probe, not a step, so the queue stays aligned for every existing
            // case. Blocked = the platform's refusal text on a zero-size row.
            if (expression.includes('无法开启赞赏')) {
                return opts.rewardRowBlocked === true
                    ? { clickable: false, blocked: true, text: '不开启 无法开启赞赏，因为还没有赞赏账户授权给本公众号' }
                    : { clickable: true, blocked: false, text: '' };
            }
            if (expression.includes('.article_url_setting')) {
                if (readbackBroken('input.js_url')) throw new Error('committed readback refused');
                if (!urlCommitted) return null;
                return typeof opts.inputValue === 'function'
                    ? opts.inputValue('input.js_url')
                    : (opts.inputValue ?? '');
            }
            // The audio menu-opening evaluates are click actions, not probes: they never consume a
            // scripted return (0272 added the toolbar-trigger click to the same action pair).
            const isMenuOpen = expression.includes('js_insertaudio') || expression.includes('audio_music_plugin_btn');
            ops.push(isMenuOpen ? 'open-audio-menu' : 'eval');
            return isMenuOpen ? undefined : evalReturns.shift();
        },
        waitForTimeout: async () => {
            ops.push('pause');
        },
        press: async () => {
            ops.push('press');
        },
    };
}

describe('wechatmp-pub modal recovery before the draft save (2026-10-12)', () => {
    test('closes a leaked modal before the save click, so the draft still saves', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ dialogOpen: true }));
        const result = await makeTransport(console).publish({ content: ARTICLE });

        expect(result.ok).toBe(true);
        expect(result.metadata?.draftAttempts).toBe(1);
        // The close control ran before the save click, and the save click followed it.
        const clicks = selectorsOf(console.calls.editor, 'click');
        const closeIndex = clicks.findIndex((selector) => selector.includes('__close') || selector.includes('取消'));
        const saveIndex = clicks.findIndex(isSaveBar);
        expect(closeIndex).toBeGreaterThan(-1);
        expect(saveIndex).toBeGreaterThan(closeIndex);
    });

    test('an unclosable modal is named in the submit failure instead of a bare timeout', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ dialogOpen: true, dialogCloseable: false, saveClickThrows: true }));
        const result = await makeTransport(console).publish({ content: ARTICLE });

        expect(result.ok).toBe(false);
        // 0260 R3/AC5: the save click is refused through an unresolved overlay — the failure names
        // the residual modal and carries the same inventory that made 2026-10-12 diagnosable.
        expect(result.error).toContain('residual modal refused cleanup');
        expect(result.error).toContain('插入音频');
    });
});

describe('wechatmp-pub 文章 draft enrichment (metadata.wechatmp)', () => {
    test('a cover panel without 从图片库选择 warns and closes the panel instead of leaking it', async () => {
        await seedMedia();
        // The measured 2026-10-12 console: the library entry is gone, and the panel stayed open,
        // which then click-blocked 赞赏/原文链接/创作来源/音频 and finally 保存为草稿.
        const console = makeConsole(happyState({ coverLibraryMissing: true }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, wechatmp: { coverPath: bodyImage } } },
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.warnings).toEqual(['cover: 从图片库选择 was not offered by the open cover panel']);
        // The panel was dismissed on the way out, so the settings rail and the save still ran.
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.some((selector) => selector.includes('__close') || selector.includes('取消'))).toBe(true);
        expect(selectorsOf(console.calls.editor, 'click').some(isSaveBar)).toBe(true);
    });

    test('drives 原创声明, 合集 and 创作来源 in order and sweeps the panel', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({
            content: {
                ...ARTICLE,
                metadata: {
                    ...ARTICLE.metadata,
                    wechatmp: {
                        coverPath: bodyImage,
                        original: true,
                        reward: true,
                        author: '冰原奔狼',
                        collection: '每日AI资讯',
                        claimSource: '个人观点，仅供参考',
                    },
                },
            },
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.enrichWarnings).toBeUndefined();

        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks).toContain('#js_original .setting-group__content-info');
        expect(clicks).toContain('.allow_click_opr.js_article_tags_label');
        expect(clicks).toContain('#js_claim_source_area .allow_click_opr');
        expect(clicks.some((selector) => selector.includes('文字原创'))).toBe(true);
        // 0272 measured: the declaration radio and the agreement checkbox are both clicked.
        expect(clicks.some((selector) => selector.includes('js_original_type_radio'))).toBe(true);
        expect(clicks.some((selector) => selector.includes('original_agreement'))).toBe(true);
        expect(clicks.some((selector) => selector.includes('每日AI资讯'))).toBe(true);
        // 创作来源 is the operator's own stance, not the platform's AI-generation label.
        expect(clicks.some((selector) => selector.includes('个人观点，仅供参考'))).toBe(true);
        // 赞赏 opens alongside 原创 now (operator walk 2026-10-10).
        expect(clicks).toContain('.setting-group__switch.js_reward_open');
        const fills = console.calls.editor.filter((call) => call.op === 'fill').map((call) => String(call.args[1]));
        expect(fills).toContain('每日AI资讯');
    });

    test('a 原创 dialog that does not commit becomes a warning, not a false success', async () => {
        const ops: string[] = [];
        // pre-read, post-read, the residual probe after the failed step, and the rail's closing sweep.
        const warnings = await enrichArticle(recordingPage(ops, [false, false, false, false]), {
            original: true,
            author: '冰原奔狼',
        });
        expect(warnings).toEqual(['原创声明: 原创声明未生效，请手动设置']);
        expect(ops).toContain('click button:has-text("取消")');
    });

    test('a 原创 dialog that commits leaves no warning', async () => {
        const ops: string[] = [];
        // pre-read true → the row is never opened; post-read true; the closing sweep probes `closed`.
        const warnings = await enrichArticle(recordingPage(ops, [true, true, false]), {
            original: true,
            author: '冰原奔狼',
        });
        expect(warnings).toEqual([]);
        // Committed settings are never re-opened (and never toggled off).
        expect(ops.some((op) => op.includes('#js_original .setting-group__'))).toBe(false);
    });

    test('原文链接 fills the surfdash URL, and 赞赏 takes its account from 作者 when empty', async () => {
        const ops: string[] = [];
        // reward pre-read uncommitted → open + fill; reward post-read committed; then the 赞赏 and
        // 原文链接 residual probes and the closing sweep all read `closed`; the committed URL readback
        // comes from the locator (`opts.inputValue`), not evaluate.
        const warnings = await enrichArticle(
            recordingPage(ops, [false, true, false, false, false], {
                // Only the 原文链接 dialog's URL field carries the committed value; the 赞赏账户 stays empty.
                inputValue: (selector) =>
                    selector.includes('input.js_url') ? 'https://surfing.salty.vip/zh/posts/20261010-ai-ai' : '',
            }),
            {
                reward: true,
                author: '冰原奔狼',
                originalUrl: 'https://surfing.salty.vip/zh/posts/20261010-ai-ai',
            },
        );
        expect(warnings).toEqual([]);
        expect(ops).toContain('click .setting-group__switch.js_reward_open');
        expect(ops).toContain('click #js_article_url_area .js_article_url_allow_click');
        // The 赞赏账户 defaults from 作者; the URL lands in the 原文链接 dialog's field.
        expect(ops.some((op) => op.startsWith('fill ') && op.includes('冰原奔狼'))).toBe(true);
        expect(ops.some((op) => op.startsWith('fill ') && op.includes('surfing.salty.vip'))).toBe(true);
    });

    test('a creation-source choice that does not stick becomes a warning', async () => {
        const ops: string[] = [];
        const warnings = await enrichArticle(recordingPage(ops, [false, false, false, false]), {
            claimSource: '个人观点，仅供参考',
        });
        expect(warnings).toEqual(['创作来源: 未生效，请手动设置']);
    });

    test('0260: a reward row that dies mid-step still ends as 赞赏未生效 after the refusal sweep', async () => {
        const ops: string[] = [];
        // pre-read uncommitted; the retry sweep, the fail sweep, the residual probe and the closing
        // sweep all read `closed`; the step warning is the sliced locator error.
        const warnings = await enrichArticle(
            recordingPage(ops, [false, false, false, false, false], { failOn: 'js_reward_open' }),
            { reward: true, author: '冰原奔狼' },
        );
        expect(warnings).toContain('赞赏: 赞赏未生效，请手动设置');
        // The row click was broken by failOn (it throws before recording), but both retry sweeps ran.
        expect(warnings.some((w) => w.startsWith('赞赏:') && w.includes('detached row'))).toBe(true);
    });

    test('the measured 2026-11-20 shape: a row carrying the platform refusal is a capability in ONE step, never an 8 s click', async () => {
        const ops: string[] = [];
        // Pre-read uncommitted only; every later scripted value is the panel sweep reading `closed`, so
        // any extra click or dialog wait would consume one and show up as a shifted warning list.
        const started = Date.now();
        const warnings = await enrichArticle(
            recordingPage(ops, [false, false, false, false, false], { rewardRowBlocked: true }),
            { reward: true, author: '冰原奔狼' },
        );
        const elapsedMs = Date.now() - started;
        // The platform's own reason is quoted back, word for word, as the capability warning.
        expect(warnings.some((w) => w.includes('无法开启赞赏，因为还没有赞赏账户授权给本公众号'))).toBe(true);
        expect(warnings.some((w) => w.startsWith('赞赏: 需要赞赏账户'))).toBe(true);
        // No row click was attempted, and no confirm click either: the row has no box to click.
        expect(ops.some((op) => op.includes('js_reward_open') || op.includes('js_reward_allow_click'))).toBe(false);
        expect(ops.some((op) => op.includes('确认') || op.includes('确定'))).toBe(false);
        // Fast by construction: the whole step is one evaluation plus the field sweep, not an 8 s click
        // timeout plus a retry of the same impossible click.
        expect(elapsedMs).toBeLessThan(2_000);
    });

    test('a healthy account still opens the row and takes its account from 作者', async () => {
        const ops: string[] = [];
        const warnings = await enrichArticle(recordingPage(ops, [false, false, false, false, false]), {
            reward: true,
            author: '冰原奔狼',
        });
        // The row-level read answered "clickable", so the old path ran unchanged.
        expect(ops.some((op) => op.startsWith('click ') && op.includes('js_reward_open'))).toBe(true);
        expect(warnings.some((w) => w.includes('无法开启赞赏'))).toBe(false);
    });

    test('0260: an absent 合集 row exhausts openRow and warns once instead of crashing', async () => {
        const ops: string[] = [];
        const warnings = await enrichArticle(
            recordingPage(ops, [false, false, false, false], {
                missingOn: ['js_article_tags_label', 'text=合集'],
            }),
            { collection: '每日AI资讯' },
        );
        expect(warnings).toEqual([
            '合集: no 合集 row control among [.allow_click_opr.js_article_tags_label | text=合集]',
        ]);
    });

    test('0260: committed probes that throw degrade to unobservable — steps run, warnings fire, never success', async () => {
        const ops: string[] = [];
        const base = recordingPage(ops, [], {});
        const page: WechatPage = {
            ...base,
            evaluate: (expression: string) =>
                expression.includes('#js_original') ||
                expression.includes('#js_reward_setting_area') ||
                expression.includes('#js_claim_source_area')
                    ? Promise.reject(new Error('probe window gone'))
                    : base.evaluate(expression),
        };
        // The scripted residual queue is empty: every modalState probe reads `undefined` = unknown,
        // which must surface as the unknown-overlay warning, never as a cleaned-up success.
        const warnings = await enrichArticle(page, {
            original: true,
            reward: true,
            author: '冰原奔狼',
            claimSource: '个人观点，仅供参考',
        });
        // An unobservable residual is warned once per step; the residual contract then suppresses
        // the per-setting 未生效 warning (unknown ≠ clean, but already surfaced).
        expect(warnings).toEqual([
            '原创声明: dialog state unknown after cleanup — a residual overlay may block later steps',
            '赞赏: dialog state unknown after cleanup — a residual overlay may block later steps',
            '创作来源: dialog state unknown after cleanup — a residual overlay may block later steps',
        ]);
    });

    test('0260: committed readbacks that reject degrade to warnings, never a claimed success', async () => {
        const ops: string[] = [];
        // The 赞赏账户 readback rejecting falls back to "empty" (author fills); the 原文链接 readback
        // rejecting degrades to null and the mismatch warning — neither claims success silently.
        const warnings = await enrichArticle(
            recordingPage(ops, [false, true, false, false, false], {
                inputValueFailsOn: ['赞赏', 'input.js_url'],
            }),
            {
                reward: true,
                author: '冰原奔狼',
                originalUrl: 'https://surfing.salty.vip/zh/posts/20261010-ai-ai',
            },
        );
        expect(warnings).toEqual(['原文链接: 已提交但未读取到已保存的链接，请核对']);
        // The reward account was still filled from 作者 despite the rejected readback.
        expect(ops.some((op) => op.startsWith('fill ') && op.includes('冰原奔狼'))).toBe(true);
    });

    test('insertAudioMaterial reuses the same-title 素材库 material and verifies placement at the top', async () => {
        const ops: string[] = [];
        const { warning } = await insertAudioMaterial(
            // caret, match (JSON identity), insert, verify (the menu-open evaluates script no returns).
            recordingPage(ops, [
                undefined,
                '{"state":"checked","identity":"media-1"}',
                true,
                '{"state":"top","identity":"media-1"}',
            ]),
            AUDIO_INPUT,
        );
        expect(warning).toBe('');
        expect(ops).toContain('open-audio-menu');
        // Two settles: the toolbar trigger's dropdown, then the picker dialog.
        expect(ops.filter((op) => op === 'pause')).toHaveLength(2);
        // A reused material uploads nothing; the toolbar trigger + menu item open the picker.
        expect(ops.some((op) => op.startsWith('files '))).toBe(false);
        expect(ops.filter((op) => op === 'open-audio-menu')).toHaveLength(2); // toolbar trigger + menu item
    });

    test('0272 measured: a 赏-blocked account fails by default and warns when partial enrichment is allowed', async () => {
        await seedMedia();
        const input = {
            content: {
                ...ARTICLE,
                metadata: { ...ARTICLE.metadata, wechatmp: { coverPath: bodyImage, reward: true } },
            },
        };
        const refused = await makeConsole(happyState({ rewardBlocked: true }));
        const refusal = await makeTransport(refused).publish(input);
        expect(refusal.ok).toBe(false);
        expect(refusal.error).toContain('draft saved but enrichment did not apply');

        const previous = process.env.WECHATMP_ALLOW_PARTIAL_ENRICH;
        process.env.WECHATMP_ALLOW_PARTIAL_ENRICH = '1';
        try {
            const console = makeConsole(happyState({ rewardBlocked: true }));
            const result = await makeTransport(console).publish(input);
            expect(result.ok).toBe(true);
            expect(result.metadata?.enrichWarnings).toEqual([expect.stringContaining('需要赞赏账户')]);
            // No 赏-account fill attempt; the rail still finished (the rest of the metadata is unset).
            const fills = console.calls.editor.filter((call) => call.op === 'fill').map((call) => String(call.args[0]));
            expect(fills.some((selector) => selector.includes('js_reward_'))).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.WECHATMP_ALLOW_PARTIAL_ENRICH;
            else process.env.WECHATMP_ALLOW_PARTIAL_ENRICH = previous;
        }
    });

    test('0272 measured: a missing 原文链接 row fails by default and warns when explicitly allowed', async () => {
        await seedMedia();
        const input = {
            content: {
                ...ARTICLE,
                metadata: {
                    ...ARTICLE.metadata,
                    wechatmp: { coverPath: bodyImage, originalUrl: 'https://example.com/post' },
                },
            },
        };
        const refused = await makeConsole(happyState({ urlRowMissing: true }));
        const refusal = await makeTransport(refused).publish(input);
        expect(refusal.ok).toBe(false);
        expect(refusal.error).toContain('draft saved but enrichment did not apply');

        const previous = process.env.WECHATMP_ALLOW_PARTIAL_ENRICH;
        process.env.WECHATMP_ALLOW_PARTIAL_ENRICH = '1';
        try {
            const console = makeConsole(happyState({ urlRowMissing: true }));
            const result = await makeTransport(console).publish(input);
            expect(result.ok).toBe(true);
            expect(result.metadata?.enrichWarnings).toEqual([expect.stringContaining('原文链接: 行不存在')]);
            const clicks = selectorsOf(console.calls.editor, 'click');
            expect(clicks.some((selector) => selector.includes('js_url_checkbox'))).toBe(false);
            expect(clicks.some((selector) => selector.includes('btm-card-link__switch'))).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.WECHATMP_ALLOW_PARTIAL_ENRICH;
            else process.env.WECHATMP_ALLOW_PARTIAL_ENRICH = previous;
        }
    }, 15000); // Two full fake-console publishes exceed Bun's 5s default.

    test('0272 measured: an absent 一键排版 control is skipped silently', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ layoutMissing: true }));
        const result = await makeTransport(console).publish({ content: ARTICLE });
        expect(result.ok).toBe(true);
        expect(result.metadata?.enrichWarnings).toBeUndefined();
    });

    test('0272 measured: the library cover waits for the audio material (deferred cover)', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({
            content: {
                ...ARTICLE,
                metadata: {
                    ...ARTICLE.metadata,
                    wechatmp: {
                        coverPath: bodyImage,
                        coverSource: 'library',
                        audioPath: '/tmp/episode.mp3',
                        audioTitle: '每日AI乱炖 #1',
                        audioCoverPath: '/tmp/episode-cover.png',
                    },
                },
            },
        });
        expect(result.ok).toBe(true);
        // AC5 (req R6): the audio material's upload attempt runs before the cover picker's
        // library path — the deferred cover only picks from the 图片库 after the audio block.
        const ops = console.calls.editor;
        const audioIdx = ops.findIndex((call) => String(call.args[0]).includes('js_insertaudio'));
        const firstLibraryPick = ops.findIndex((call) => String(call.args[0]).includes('js_imagedialog'));
        expect(audioIdx).toBeGreaterThan(-1);
        expect(firstLibraryPick).toBeGreaterThan(audioIdx);
    });

    test('insertAudioMaterial uploads the audio + cover when the 素材库 has no same-title material', async () => {
        const ops: string[] = [];
        const { warning } = await insertAudioMaterial(
            // caret, match missing ×3 (the 素材库 rows stream in), agree, post-upload match, insert, verify.
            recordingPage(ops, [
                undefined,
                'missing',
                'missing',
                'missing',
                'checked',
                '{"state":"checked","identity":"media-1"}',
                true,
                '{"state":"top","identity":"media-1"}',
            ]),
            AUDIO_INPUT,
        );
        expect(warning).toBe('');
        // Both artifacts reach the form, and the service-rules box is ticked before 保存.
        const uploads = ops.filter((op) => op.startsWith('files '));
        expect(uploads).toHaveLength(2);
        expect(uploads[0]).toContain('audio');
        expect(uploads[1]).toContain('image/');
        expect(ops.filter((op) => op === 'open-audio-menu')).toHaveLength(2); // toolbar trigger + menu item
    });

    test('insertAudioMaterial reports an unticked service-rules box instead of silently saving', async () => {
        const ops: string[] = [];
        const { warning } = await insertAudioMaterial(
            recordingPage(ops, [undefined, 'missing', 'missing', 'missing', 'no-label']),
            AUDIO_INPUT,
        );
        expect(warning).toContain('服务规则勾选失败');
        expect(warning).toContain('no-label');
    });

    test('a failure after the cover picker verified the unique row reports coverSeeded (library rescue)', async () => {
        // 2026-11-09: the daily run lost BOTH audio and cover because the chooser-close wait was
        // tight and the post-failure guard skipped the library cover even though the cover had
        // committed. The contract: failures AFTER the picker's unique-row check carry
        // coverSeeded=true so enrichArticleDraft still binds the cover.
        const cover = join(tmpdir(), `kk-audio-seeded-${randomUUID()}.png`);
        await Bun.write(cover, 'png');
        let chooserClosed = false;
        const evals: string[] = ['missing', 'missing', 'missing'];
        const page = {
            goto: async () => undefined,
            url: () => editorUrlFor(0),
            press: async () => undefined,
            waitForTimeout: async () => undefined,
            setInputFiles: async () => undefined,
            evaluate: async (script: string) => {
                if (script.includes('audio_item')) return evals.shift() ?? 'missing';
                if (script.includes('weui-desktop-loading')) return true;
                if (script.includes('img-picker__item')) return script.includes('classList') ? true : '0';
                if (script.includes('我已阅读并同意')) return 'no-label';
                if (script.includes('插入') && script.includes('button')) return true;
                return undefined;
            },
            locator: (selector: string) => ({
                count: async () => (selector.includes('选择图片') && chooserClosed ? 0 : 1),
                first: () => ({
                    count: async () => 1,
                    isVisible: async () => (selector.includes('选择图片') ? !chooserClosed : true),
                    waitFor: async () => undefined,
                    click: async () => {
                        if (selector.includes('完成')) chooserClosed = true;
                    },
                    fill: async () => undefined,
                }),
            }),
        } as unknown as WechatPage;
        try {
            const stuck = await insertAudioMaterial(page, { title: 'Episode 1', audioPath: 'a.mp3', coverPath: cover });
            expect(stuck.warning).toContain('服务规则勾选失败');
            expect(stuck.coverSeeded).toBe(true);

            // Nothing committed before the upload control: a dialog that opens but offers no
            // 上传音频 control — the walk returns before any cover upload.
            const noUpload = {
                ...page,
                locator: (selector: string) => ({
                    count: async () => (selector.includes('audio_dialog') ? 1 : 0),
                    first: () => ({
                        count: async () => (selector.includes('audio_dialog') ? 1 : 0),
                        isVisible: async () => selector.includes('audio_dialog'),
                        waitFor: async () => undefined,
                        click: async () => undefined,
                        fill: async () => undefined,
                    }),
                }),
            } as unknown as WechatPage;
            const early = await insertAudioMaterial(noUpload, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: cover,
            });
            expect(early.warning).toContain('上传音频 control not found');
            expect(early.coverSeeded).toBe(false);
        } finally {
            await rm(cover, { force: true });
        }
    });

    test('a step whose row keeps detaching is retried once, then warned and swept', async () => {
        const ops: string[] = [];
        const warnings = await enrichArticle(
            recordingPage(
                ops,
                // sweep 1's two probes (open → close-btn pass → closed), the residual probe, and the
                // closing sweep.
                [true, false, false, false],
                { failOn: 'js_article_tags_label' },
            ),
            { collection: '每日AI资讯' },
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('合集');
        expect(warnings[0]).toContain('detached row');
        // Two attempts, each followed by a dialog sweep, plus the rail's closing sweep.
        expect(ops.filter((op) => op === 'click button:has-text("取消")')).toHaveLength(3);
    });

    test('a step whose row detaches once succeeds on its retry without a warning', async () => {
        const ops: string[] = [];
        const page = recordingPage(ops, [
            /* retry sweep probes */ true,
            false,
            /* residual probe */ false,
            /* closing sweep */ false,
        ]);
        let firstTagsClick = true;
        const flaky: WechatPage = {
            ...page,
            locator: (selector) => {
                const original = page.locator(selector);
                return {
                    count: () => original.count(),
                    first: () => {
                        const first = original.first();
                        return {
                            ...first,
                            click: async (options) => {
                                if (selector === '.allow_click_opr.js_article_tags_label' && firstTagsClick) {
                                    firstTagsClick = false;
                                    throw new Error('detached row');
                                }
                                await first.click(options);
                            },
                        };
                    },
                };
            },
        };
        const warnings = await enrichArticle(flaky, { collection: '每日AI资讯' });
        expect(warnings).toEqual([]);
        // The failed attempt's sweep, then the rail's closing sweep.
        expect(ops.filter((op) => op === 'click button:has-text("取消")')).toHaveLength(2);
    });

    test('insertAudioMaterial warns for each non-committed insert outcome it can meet', async () => {
        const cases: Array<[unknown[], string]> = [
            [[undefined, '{"state":"checked","identity":"media-1"}', false], '插入按钮未找到'],
            [
                [
                    undefined,
                    '{"state":"checked","identity":"media-1"}',
                    true,
                    '{"state":"absent","identity":"media-1"}',
                ],
                '插入未生效',
            ],
            [
                [undefined, '{"state":"checked","identity":"media-1"}', true, '{"state":"noeditor","identity":null}'],
                '插入未生效',
            ],
            // 0260: a placed node whose identity cannot be tied to the requested material is a warning.
            [
                [undefined, '{"state":"checked","identity":"media-1"}', true, '{"state":"top","identity":"other"}'],
                '无法核对素材身份',
            ],
            [[undefined, 'error'], '素材匹配探测失败'],
            [[undefined, '{"state":"ambiguous"}'], '列表匹配到多个同名条目'],
            [[undefined, '{"state":"nobox"}'], '行没有勾选框'],
            [[undefined, 'not-json'], '返回未知结果'],
            [[undefined, '{"state":"checked","identity":"media-1"}', true, 'not-json'], '无法读取正文状态'],
            [
                [
                    undefined,
                    '{"state":"checked","identity":"media-1"}',
                    true,
                    '{"state":"middle","identity":"media-1"}',
                ],
                '已插入但未在文首',
            ],
        ];
        for (const [returns, expected] of cases) {
            const ops: string[] = [];
            const { warning } = await insertAudioMaterial(recordingPage(ops, returns), AUDIO_INPUT);
            expect(warning).toContain(expected);
        }
    });

    test('the daily stage metadata (原创/合集/创作来源/audioTitle) reaches the editor as one rail', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const result = await makeTransport(console).publish({
            content: {
                ...ARTICLE,
                metadata: { publishStatus: 'draft', wechatmp: { coverPath: bodyImage, audioTitle: '' } },
            },
        });
        expect(result.ok).toBe(true);
        // An empty audioTitle means no audio step at all.
        expect(result.metadata?.enrichWarnings).toBeUndefined();
        expect(selectorsOf(console.calls.editor, 'click').some((selector) => selector.includes('js_insertaudio'))).toBe(
            false,
        );
    });
});

// ---------------------------------------------------------------------------
// The Playwright adapter and the launcher seam
// ---------------------------------------------------------------------------

describe('wrapPlaywrightPage / wrapPlaywrightContext (real adapters, offline via stubs)', () => {
    interface AdapterLog {
        calls: string[];
    }
    function stubRawPage(log: AdapterLog): unknown {
        return {
            goto: async (url: string, options?: Record<string, unknown>) => {
                log.calls.push(`goto:${url}:${String(options?.waitUntil)}`);
            },
            locator: (selector: string) => ({
                count: async () => 1,
                first: () => ({
                    count: async () => 7,
                    isVisible: async () => true,
                    fill: async (text: string) => {
                        log.calls.push(`fill:${selector}:${text}`);
                    },
                    click: async () => {
                        log.calls.push(`click:${selector}`);
                    },
                    pressSequentially: async (text: string) => {
                        log.calls.push(`type:${selector}:${text}`);
                    },
                    waitFor: async () => {
                        log.calls.push(`wait:${selector}`);
                    },
                    textContent: async () => '更新于 13:12',
                    inputValue: async () => 'mirror',
                }),
            }),
            setInputFiles: async (selector: string, paths: readonly string[]) => {
                log.calls.push(`files:${selector}:${paths.join(',')}`);
            },
            screenshot: async (options: { path: string }) => {
                log.calls.push(`shot:${options.path}`);
            },
            url: () => CONSOLE_HOME,
            evaluate: async (expression: string) => `eval:${expression.slice(0, 10)}`,
            waitForTimeout: async (ms: number) => {
                log.calls.push(`pause:${ms}`);
            },
            keyboard: {
                press: async (key: string) => {
                    log.calls.push(`press:${key}`);
                },
            },
        };
    }

    test('delegates goto/locator/fill/click/type/inputValue/setInputFiles/evaluate/press', async () => {
        const log: AdapterLog = { calls: [] };
        const page = wrapPlaywrightPage(stubRawPage(log));
        await page.goto('https://mp.weixin.qq.com/');
        expect(await page.locator('input').count()).toBe(1);
        const first = page.locator('textarea#title').first();
        expect(await first.count()).toBe(7);
        expect(await first.isVisible()).toBe(true);
        expect(await first.inputValue?.()).toBe('mirror');
        await first.fill('hello');
        await first.click();
        await first.type?.('typed');
        await first.waitFor?.({ state: 'visible', timeout: 10 });
        expect(await first.textContent?.()).toBe('更新于 13:12');
        await page.setInputFiles('input[type="file"]', ['/a.png']);
        // Diagnostics seam: the 2026-11-23 音频 stall was only readable from a PNG.
        await page.screenshot?.('/tmp/stall.png');
        await page.evaluate('1+1');
        await page.waitForTimeout?.(5);
        await page.press?.('Escape');
        expect(page.url()).toBe(CONSOLE_HOME);
        expect(log.calls).toEqual([
            'goto:https://mp.weixin.qq.com/:domcontentloaded',
            'fill:textarea#title:hello',
            'click:textarea#title',
            'type:textarea#title:typed',
            'wait:textarea#title',
            'files:input[type="file"]:/a.png',
            'shot:/tmp/stall.png',
            'pause:5',
            'press:Escape',
        ]);
    });

    test('wrapPlaywrightContext exposes the entry page first and caches wrappers per raw page', async () => {
        const log: AdapterLog = { calls: [] };
        const entry = stubRawPage(log);
        const second = stubRawPage(log);
        const context = {
            pages: () => [entry, second],
            newPage: async () => second,
            close: async () => {
                log.calls.push('close');
            },
        };
        const opened = wrapPlaywrightContext(context, entry);
        expect(opened.pages()[0]).toBe(opened.page);
        expect(opened.pages()).toHaveLength(2);
        await opened.newPage();
        expect(opened.pages()).toHaveLength(2);
        await opened.close();
        expect(log.calls).toContain('close');
    });
});

describe('wechatmp-pub readiness predicates', () => {
    test('the console reads ready on a token-bearing route or the recorded home fragment', () => {
        const url = (value: string) => ({ url: () => value });
        expect(isConsoleReady(url(CONSOLE_HOME))).toBe(true);
        expect(isConsoleReady(url('https://mp.weixin.qq.com/cgi-bin/home?lang=zh_CN'))).toBe(true);
        expect(isConsoleReady(url('https://mp.weixin.qq.com/'))).toBe(false);
        expect(isWechatLoggedIn(url(CONSOLE_HOME))).toBe(true);
        expect(isWechatLoggedIn(url('https://mp.weixin.qq.com/'))).toBe(false);
    });
});

describe('checkWechatSession (preflight)', () => {
    test('uses the dedicated wechatmp profile with headless reuse and console readiness', async () => {
        // The real withProfilePage would launch a browser; here we only pin the seam: without a
        // profile dir override this fails fast on CI rather than opening anything headed.
        process.env.WECHATMP_PROFILE_DIR = '/tmp/nonexistent-wechat-profile-test';
        try {
            await expect(checkWechatSession('/tmp/nonexistent-wechat-profile-test')).rejects.toThrow();
        } finally {
            delete process.env.WECHATMP_PROFILE_DIR;
        }
    });
});

describe('browser seam (stubbed openPersistentBrowser)', () => {
    function stubCookieContext(page: Page): BrowserContext {
        return {
            addCookies: async () => undefined,
            pages: () => [page],
            newPage: async () => page,
            waitForEvent: async () => page,
            close: async () => undefined,
        } as unknown as BrowserContext;
    }

    function stubFlowPage(urls: string[]): Page {
        let call = 0;
        return {
            url: () => urls[Math.min(call++, urls.length - 1)],
            goto: async () => undefined,
            close: async () => undefined,
            waitForLoadState: async () => undefined,
            waitForURL: async () => undefined,
            locator: () => ({
                first: () => ({
                    count: async () => 1,
                    isVisible: async () => true,
                    fill: async () => undefined,
                    click: async () => undefined,
                    waitFor: async () => undefined,
                    evaluate: async () => undefined,
                }),
            }),
        } as unknown as Page;
    }

    async function writeSessionState(profileDir: string): Promise<void> {
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            join(profileDir, 'storage-state.json'),
            JSON.stringify({ cookies: [{ name: 'slave_sid', value: 'v' }] }),
        );
    }

    test('storageStatePath resolves inside the profile dir', () => {
        expect(storageStatePath('/profiles/wechatmp')).toBe('/profiles/wechatmp/storage-state.json');
    });

    test('checkWechatSession injects saved cookies and confirms the console session', async () => {
        const profileDir = join(process.cwd(), '.works/tmp/test-wechat-profile');
        await writeSessionState(profileDir);
        // First poll misses the console fragment (exercises the retry sleep), second confirms login.
        const page = stubFlowPage(['https://mp.weixin.qq.com/', CONSOLE_HOME]);
        let launches = 0;
        const openSpy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(async () => {
            launches += 1;
            return stubCookieContext(page);
        });
        try {
            await checkWechatSession(profileDir);
            expect(launches).toBe(1);
            expect(openSpy).toHaveBeenCalledWith({ profileDir, headless: true, launcher: kkBrowserLauncher });
        } finally {
            mock.restore();
            await rm(profileDir, { recursive: true, force: true });
        }
    });

    test('WECHATMP_PROFILE_DIR is what the transport resolves and reports', async () => {
        await seedMedia();
        const console = makeConsole(happyState());
        const profileDir = join(process.cwd(), '.works/tmp/test-wechat-profile-flow');
        const prevProfileDir = process.env.WECHATMP_PROFILE_DIR;
        process.env.WECHATMP_PROFILE_DIR = profileDir;
        try {
            const result = await makeTransport(console).publish({ content: ARTICLE });
            expect(result.ok).toBe(true);
            expect(result.metadata?.profileDir).toBe(profileDir);
            expect(result.message).toContain(profileDir);
        } finally {
            if (prevProfileDir === undefined) delete process.env.WECHATMP_PROFILE_DIR;
            else process.env.WECHATMP_PROFILE_DIR = prevProfileDir;
        }
    });
});

// ---------------------------------------------------------------------------
// CLI surface and the markdown renderer's R9 safety
// ---------------------------------------------------------------------------

describe('markdownToWechatHtml', () => {
    test('maps headings, paragraphs, and code', () => {
        const html = markdownToWechatHtml('# Title\n\nHello **world**.\n\n```\nconst x = 1;\n```');
        expect(html).toContain('<h1>Title</h1>');
        expect(html).toContain('<strong>world</strong>');
        expect(html).toContain('<pre><code>');
        expect(html).toContain('const x = 1;');
    });
});

describe('markdownToWechatHtml inline safety (R9)', () => {
    test('a quote in a link destination cannot close the href attribute', () => {
        const html = markdownToWechatHtml('[y](a" onclick="z)');
        expect(html).not.toContain(' onclick=');
    });

    test('a javascript: destination is not turned into a link', () => {
        const html = markdownToWechatHtml('[x](javascript:alert(1))');
        expect(html).not.toContain('<a');
        expect(html).not.toContain('javascript:');
        expect(html).toContain('x');
    });

    test('an http(s) destination still renders a link', () => {
        expect(markdownToWechatHtml('[ok](https://example.com)')).toContain('<a href="https://example.com">ok</a>');
    });

    test('double quotes in text are escaped', () => {
        expect(markdownToWechatHtml('He said "hi"')).toContain('&quot;hi&quot;');
    });
});

describe('wechatmp-pub CLI surface (unchanged contract)', () => {
    test('processPublishIO uses FakeFileCliTransport offline', async () => {
        const fake = new FakeFileCliTransport();
        await mkdir(tmpRoot, { recursive: true });
        const inPath = join(tmpRoot, 'in.json');
        const outPath = join(tmpRoot, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
        try {
            await processPublishIO(inPath, outPath, fake);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            await rm(inPath, { force: true });
            await rm(outPath, { force: true });
        }
    });

    test('a top-level input `options` object selects the operation', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ mode: '视频' }));
        await mkdir(tmpRoot, { recursive: true });
        const inPath = join(tmpRoot, 'op.json');
        const outPath = join(tmpRoot, 'op-result.json');
        await writeFile(inPath, JSON.stringify({ ...mediaContent({ video }), options: { operation: '视频' } }));
        try {
            await processPublishIO(inPath, outPath, makeTransport(console));
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).metadata?.operation).toBe('视频');
        } finally {
            await rm(inPath, { force: true });
            await rm(outPath, { force: true });
        }
    });

    test('getPublishTransport fake switch', () => {
        expect(getPublishTransport()).toBeInstanceOf(WechatmpBrowserTransport);
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('main returns 1 without args and 0 on fake transport', async () => {
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');
        } finally {
            restore();
            process.argv = origArgv;
        }
        await mkdir(tmpRoot, { recursive: true });
        const inPath = join(tmpRoot, 'main.json');
        const outPath = join(tmpRoot, 'main-result.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.argv = origArgv;
            await rm(inPath, { force: true });
            await rm(outPath, { force: true });
        }
    });

    test('invocable via runInvoke', async () => {
        await mkdir(tmpRoot, { recursive: true });
        const inPath = join(tmpRoot, 'invoke.json');
        const outPath = join(tmpRoot, 'invoke-result.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const code = await runInvoke({
                plugin: 'wechatmp-pub',
                inPath,
                outPath,
                pluginsRoot: join(process.cwd(), 'plugins'),
            });
            expect(code).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(inPath, { force: true });
            await rm(outPath, { force: true });
        }
    });

    describe('flow.ts edge cases and branches', () => {
        test('draftRowContainers returns title selectors and readDraftBaseline reads stamp', async () => {
            const containers = draftRowContainers('Hello');
            expect(containers.length).toBeGreaterThan(0);
            const mockPage = {
                locator: () => ({
                    count: async () => 1,
                    first: () => ({
                        count: async () => 1,
                        isVisible: async () => true,
                        textContent: async () => '更新于 2026-11-06 12:00',
                    }),
                }),
            } as unknown as WechatPage;
            const baseline = await readDraftBaseline(mockPage, 'Hello');
            expect(baseline.stamp).toBe('更新于 2026-11-06 12:00');
        });

        test('canonicalSavedEditorUrl and appmsgIdFromCanonical validate URLs', () => {
            expect(canonicalSavedEditorUrl('not-a-valid-url')).toBeNull();
            expect(canonicalSavedEditorUrl('http://example.com/other')).toBeNull();
            expect(canonicalSavedEditorUrl('https://mp.weixin.qq.com/cgi-bin/other')).toBeNull();
            expect(canonicalSavedEditorUrl('https://mp.weixin.qq.com/cgi-bin/appmsg?action=view')).toBeNull();
            expect(canonicalSavedEditorUrl('https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&isNew=1')).toBeNull();
            expect(
                canonicalSavedEditorUrl('https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&isNew=0&appmsgid='),
            ).toBeNull();
            const valid = 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&isNew=0&appmsgid=1001';
            expect(canonicalSavedEditorUrl(valid)).toBe(valid);

            expect(appmsgIdFromCanonical('not-a-valid-url')).toBeNull();
            expect(appmsgIdFromCanonical(valid)).toBe('1001');
            expect(
                appmsgIdFromCanonical('https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&isNew=0&appmsgid=%20'),
            ).toBeNull();
        });

        test('readTitleMirror handles throwing selectors, missing locator, throwing value, and success', async () => {
            const pageThrows = {
                locator: () => {
                    throw new Error('locator throws');
                },
            } as unknown as WechatPage;
            const resThrows = await readTitleMirror(pageThrows);
            expect(resThrows).toEqual({ observed: false, value: '' });

            const pageNoFn = {
                locator: () => ({
                    count: async () => 1,
                    first: () => ({
                        count: async () => 1,
                        isVisible: async () => true,
                        inputValue: undefined,
                    }),
                }),
            } as unknown as WechatPage;
            const resNoFn = await readTitleMirror(pageNoFn);
            expect(resNoFn).toEqual({ observed: false, value: '' });

            const pageValThrows = {
                locator: () => ({
                    count: async () => 1,
                    first: () => ({
                        count: async () => 1,
                        isVisible: async () => true,
                        inputValue: async () => {
                            throw new Error('read failed');
                        },
                    }),
                }),
            } as unknown as WechatPage;
            const resValThrows = await readTitleMirror(pageValThrows);
            expect(resValThrows).toEqual({ observed: false, value: '' });

            const pageSuccess = {
                locator: () => ({
                    count: async () => 1,
                    first: () => ({
                        count: async () => 1,
                        isVisible: async () => true,
                        inputValue: async () => 'My Article Title',
                    }),
                }),
            } as unknown as WechatPage;
            const resSuccess = await readTitleMirror(pageSuccess);
            expect(resSuccess).toEqual({ observed: true, value: 'My Article Title' });
        });

        test('fillOptional handles empty value, absent selector, throw on fill, and success', async () => {
            const deps = { stepTimeoutMs: 10 } as unknown as ModeRunDeps;
            const resEmpty = await fillOptional({} as unknown as WechatPage, ['#sel'], '', 'test-desc', deps);
            expect(resEmpty).toBeNull();

            const pageAbsent = {
                locator: (sel: string) => {
                    const isSaveDraft = sel.includes('保存为草稿');
                    return {
                        count: async () => (isSaveDraft ? 1 : 0),
                        first: () => ({
                            count: async () => (isSaveDraft ? 1 : 0),
                            isVisible: async () => isSaveDraft,
                            click: async () => undefined,
                        }),
                    };
                },
            } as unknown as WechatPage;
            const resAbsent = await fillOptional(pageAbsent, ['#sel'], 'value', 'test-desc', deps);
            expect(resAbsent).toContain('none of [#sel] visible');

            const pageFillThrows = {
                locator: () => ({
                    count: async () => 1,
                    first: () => ({
                        count: async () => 1,
                        isVisible: async () => true,
                        fill: async () => {
                            throw new Error('fill error');
                        },
                    }),
                }),
            } as unknown as WechatPage;
            const resThrows = await fillOptional(pageFillThrows, ['#sel'], 'value', 'test-desc', deps);
            expect(resThrows).toContain('fill error');

            const pageOk = {
                locator: () => ({
                    count: async () => 1,
                    first: () => ({
                        count: async () => 1,
                        isVisible: async () => true,
                        fill: async () => undefined,
                    }),
                }),
            } as unknown as WechatPage;
            const resOk = await fillOptional(pageOk, ['#sel'], 'value', 'test-desc', deps);
            expect(resOk).toBeNull();
        });

        test('applyLayout handles absent control and click failure', async () => {
            const deps = {
                stepTimeoutMs: 10,
                pages: () => [],
            } as unknown as ModeRunDeps;

            const pageAbsent = {
                locator: (sel: string) => {
                    const isSaveDraft = sel.includes('保存为草稿');
                    return {
                        count: async () => (isSaveDraft ? 1 : 0),
                        first: () => ({
                            count: async () => (isSaveDraft ? 1 : 0),
                            isVisible: async () => isSaveDraft,
                            click: async () => undefined,
                        }),
                    };
                },
            } as unknown as WechatPage;
            const resAbsent = await applyLayout(pageAbsent, deps);
            expect(resAbsent).toBeNull();

            const pageClickThrows = {
                locator: (sel: string) => {
                    const isControl = sel.includes('一键排版') || sel.includes('layout') || sel.includes('js_layout');
                    return {
                        count: async () => (isControl ? 1 : 0),
                        first: () => ({
                            count: async () => (isControl ? 1 : 0),
                            isVisible: async () => isControl,
                            click: async () => {
                                throw new Error('click failed');
                            },
                        }),
                    };
                },
            } as unknown as WechatPage;
            const resClickThrows = await applyLayout(pageClickThrows, deps);
            expect(resClickThrows).toContain('click failed');
        });

        test('openDraftBox handles missing token, throws on goto, and successful card found', async () => {
            const pageNoToken = {
                url: () => 'https://mp.weixin.qq.com/cgi-bin/home',
            } as unknown as WechatPage;
            const resNoToken = await openDraftBox(pageNoToken, 'Test Title', 10, 10);
            expect(resNoToken).toBe(false);

            const pageThrows = {
                url: () => 'https://mp.weixin.qq.com/cgi-bin/home?token=123456&lang=zh_CN',
                goto: async () => {
                    throw new Error('goto timeout');
                },
            } as unknown as WechatPage;
            const resThrows = await openDraftBox(pageThrows, 'Test Title', 10, 10);
            expect(resThrows).toBe(false);

            const pageSuccess = {
                url: () => 'https://mp.weixin.qq.com/cgi-bin/home?token=123456&lang=zh_CN',
                goto: async () => undefined,
                locator: () => ({
                    count: async () => 1,
                }),
            } as unknown as WechatPage;
            const resSuccess = await openDraftBox(pageSuccess, 'Test Title', 100, 10);
            expect(resSuccess).toBe(true);
        });

        test('setCover exercises coverLibraryName with existing file and coverAssetIdentity with non-url and qpic', async () => {
            const tmpCover = join(tmpdir(), `kk-test-cover-${randomUUID()}.png`);
            await writeFile(tmpCover, 'fake-png-bytes');
            try {
                const mockPage = {
                    evaluate: async (script: string) => {
                        if (script.includes('#js_cover_area')) return 'http://mmbiz.qpic.cn/mmbiz_png/abc/0';
                        return JSON.stringify({ picked: true, src: 'http://mmbiz.qpic.cn/mmbiz_png/abc/640' });
                    },
                    locator: (sel: string) => {
                        const match =
                            sel.includes('.js_cover_btn_area') ||
                            sel.includes('js_imagedialog') ||
                            sel.includes('确定') ||
                            sel.includes('取消') ||
                            sel.includes('关闭');
                        return {
                            count: async () => (match ? 1 : 0),
                            first: () => ({
                                count: async () => (match ? 1 : 0),
                                isVisible: async () => match,
                                click: async () => undefined,
                                fill: async () => undefined,
                            }),
                        };
                    },
                } as unknown as WechatPage;

                const warn = await setCover(
                    mockPage,
                    'library',
                    { stepTimeoutMs: 50 },
                    { requested: tmpCover, binding: 'not-a-valid-url' },
                );
                expect(warn).toBeNull();
            } finally {
                await rm(tmpCover, { force: true });
            }
        });

        test('setCover warns when panel offers none of the open controls', async () => {
            const mockPage = {
                evaluate: async () => '',
                locator: (sel: string) => {
                    const match = sel.includes('取消') || sel.includes('关闭');
                    return {
                        count: async () => (match ? 1 : 0),
                        first: () => ({
                            count: async () => (match ? 1 : 0),
                            isVisible: async () => match,
                            click: async () => undefined,
                        }),
                    };
                },
            } as unknown as WechatPage;
            const warn = await setCover(mockPage, 'library', { stepTimeoutMs: 10 }, { requested: 'test.png' });
            expect(warn).toContain('the panel offers none of');
        });

        test('setCover keeps its warning contract when the page dies mid-sweep (browser closed)', async () => {
            const dead = () => Promise.reject(new Error('press: Target page, context or browser has been closed'));
            const mockPage = {
                evaluate: dead,
                locator: () => ({
                    count: dead,
                    first: () => ({ count: dead, isVisible: dead, click: dead }),
                }),
                press: dead,
                waitForTimeout: dead,
            } as unknown as WechatPage;
            // Regression: the best-effort dismiss sweep must never turn a dead target into a hard
            // failure — the cover step's contract is a named warning, never a gate.
            const warn = await setCover(mockPage, 'library', { stepTimeoutMs: 10 }, { requested: 'test.png' });
            expect(typeof warn).toBe('string');
            expect(warn).toContain('cover:');
        }, 20_000);

        test('setCover warns when wanted cover list is empty', async () => {
            const mockPage = {
                evaluate: async () => '',
                locator: (sel: string) => {
                    const match =
                        sel.includes('.js_cover_btn_area') ||
                        sel.includes('js_imagedialog') ||
                        sel.includes('取消') ||
                        sel.includes('关闭');
                    return {
                        count: async () => (match ? 1 : 0),
                        first: () => ({
                            count: async () => (match ? 1 : 0),
                            isVisible: async () => match,
                            click: async () => undefined,
                        }),
                    };
                },
            } as unknown as WechatPage;
            const warn = await setCover(mockPage, 'library', { stepTimeoutMs: 10 }, { requested: '', binding: '' });
            expect(warn).toContain('no requested cover file identity');
        });

        test('setCover warns when picker selector is not offered', async () => {
            const mockPage = {
                evaluate: async () => '',
                locator: (sel: string) => {
                    const match = sel.includes('.js_cover_btn_area') || sel.includes('取消') || sel.includes('关闭');
                    return {
                        count: async () => (match ? 1 : 0),
                        first: () => ({
                            count: async () => (match ? 1 : 0),
                            isVisible: async () => match,
                            click: async () => undefined,
                        }),
                    };
                },
            } as unknown as WechatPage;
            const warn = await setCover(mockPage, 'body', { stepTimeoutMs: 10 }, { requested: 'test.png' });
            expect(warn).toContain('was not offered by the open cover panel');
        });

        test('setCover handles pagination, ambiguity, and JSON parsing error', async () => {
            let paginationCalls = 0;
            const pageWithPagination = {
                waitForTimeout: async () => undefined,
                locator: (sel: string) => {
                    const match =
                        sel.includes('.js_cover_btn_area') ||
                        sel.includes('js_imagedialog') ||
                        sel.includes('下一页') ||
                        sel.includes('取消') ||
                        sel.includes('关闭');
                    return {
                        count: async () => (match ? 1 : 0),
                        first: () => ({
                            count: async () => (match ? 1 : 0),
                            isVisible: async () => match,
                            click: async () => undefined,
                        }),
                    };
                },
                evaluate: async (script: string) => {
                    if (script.includes('weui-desktop-pagination__num')) {
                        paginationCalls++;
                        return JSON.stringify({ page: paginationCalls === 1 ? 1 : 2, total: 2 });
                    }
                    if (script.includes('weui-desktop-loading')) return true;
                    return 'missing';
                },
            } as unknown as WechatPage;
            const warnMissing = await setCover(
                pageWithPagination,
                'library',
                { stepTimeoutMs: 50 },
                { requested: 'test.png' },
            );
            expect(warnMissing).toContain('未标出与请求文件同名的素材');

            const pageAmbiguous = {
                locator: (sel: string) => {
                    const match =
                        sel.includes('.js_cover_btn_area') ||
                        sel.includes('js_imagedialog') ||
                        sel.includes('取消') ||
                        sel.includes('关闭');
                    return {
                        count: async () => (match ? 1 : 0),
                        first: () => ({
                            count: async () => (match ? 1 : 0),
                            isVisible: async () => match,
                            click: async () => undefined,
                        }),
                    };
                },
                evaluate: async () => 'ambiguous',
            } as unknown as WechatPage;
            const warnAmbiguous = await setCover(
                pageAmbiguous,
                'library',
                { stepTimeoutMs: 50 },
                { requested: 'test.png' },
            );
            expect(warnAmbiguous).toContain('匹配到多个同名素材');

            const pageInvalidJson = {
                locator: (sel: string) => {
                    const match =
                        sel.includes('.js_cover_btn_area') ||
                        sel.includes('js_imagedialog') ||
                        sel.includes('取消') ||
                        sel.includes('关闭');
                    return {
                        count: async () => (match ? 1 : 0),
                        first: () => ({
                            count: async () => (match ? 1 : 0),
                            isVisible: async () => match,
                            click: async () => undefined,
                        }),
                    };
                },
                evaluate: async () => 'not-a-valid-json',
            } as unknown as WechatPage;
            const warnInvalid = await setCover(
                pageInvalidJson,
                'library',
                { stepTimeoutMs: 50 },
                { requested: 'test.png' },
            );
            expect(warnInvalid).toContain('素材身份探测返回未知结果');

            const pageThrows = {
                evaluate: async () => '',
                locator: (sel: string) => {
                    if (sel.includes('.js_cover_btn_area')) {
                        return {
                            count: async () => 1,
                            first: () => ({
                                count: async () => 1,
                                isVisible: async () => true,
                                click: async () => {
                                    throw new Error('click failed');
                                },
                            }),
                        };
                    }
                    return {
                        count: async () => 1,
                        first: () => ({
                            count: async () => 1,
                            isVisible: async () => true,
                            click: async () => undefined,
                        }),
                    };
                },
            } as unknown as WechatPage;
            const warnThrows = await setCover(pageThrows, 'library', { stepTimeoutMs: 50 }, { requested: 'test.png' });
            expect(warnThrows).toContain('click failed');
        });

        test('setCover handles unobserved committed cover and identity mismatch', async () => {
            const pageUnobserved = {
                locator: (sel: string) => {
                    const match =
                        sel.includes('.js_cover_btn_area') ||
                        sel.includes('js_imagedialog') ||
                        sel.includes('确定') ||
                        sel.includes('取消') ||
                        sel.includes('关闭');
                    return {
                        count: async () => (match ? 1 : 0),
                        first: () => ({
                            count: async () => (match ? 1 : 0),
                            isVisible: async () => match,
                            click: async () => undefined,
                        }),
                    };
                },
                evaluate: async (script: string) => {
                    if (script.includes('#js_cover_area')) return 'empty';
                    return JSON.stringify({ picked: true, src: 'http://example.com/test.png' });
                },
            } as unknown as WechatPage;
            const warnUnobs = await setCover(
                pageUnobserved,
                'library',
                { stepTimeoutMs: 50 },
                { requested: 'test.png' },
            );
            expect(warnUnobs).toContain('确认后面板仍显示未设置封面');

            const pageUnobservedNonEmpty = {
                locator: (sel: string) => {
                    const match =
                        sel.includes('.js_cover_btn_area') ||
                        sel.includes('js_imagedialog') ||
                        sel.includes('确定') ||
                        sel.includes('取消') ||
                        sel.includes('关闭');
                    return {
                        count: async () => (match ? 1 : 0),
                        first: () => ({
                            count: async () => (match ? 1 : 0),
                            isVisible: async () => match,
                            click: async () => undefined,
                        }),
                    };
                },
                evaluate: async (script: string) => {
                    if (script.includes('#js_cover_area')) return 'nopreview';
                    return JSON.stringify({ picked: true, src: 'http://example.com/test.png' });
                },
            } as unknown as WechatPage;
            const warnUnobsNonEmpty = await setCover(
                pageUnobservedNonEmpty,
                'library',
                { stepTimeoutMs: 50 },
                { requested: 'test.png' },
            );
            expect(warnUnobsNonEmpty).toContain('已确认但无法读取已提交封面');

            const pageMismatch = {
                locator: (sel: string) => {
                    const match =
                        sel.includes('.js_cover_btn_area') ||
                        sel.includes('js_imagedialog') ||
                        sel.includes('确定') ||
                        sel.includes('取消') ||
                        sel.includes('关闭');
                    return {
                        count: async () => (match ? 1 : 0),
                        first: () => ({
                            count: async () => (match ? 1 : 0),
                            isVisible: async () => match,
                            click: async () => undefined,
                        }),
                    };
                },
                evaluate: async (script: string) => {
                    if (script.includes('#js_cover_area')) return 'http://example.com/different.png';
                    return JSON.stringify({ picked: true, src: 'http://example.com/selected.png' });
                },
            } as unknown as WechatPage;
            const warnMismatch = await setCover(
                pageMismatch,
                'library',
                { stepTimeoutMs: 50 },
                { requested: 'test.png' },
            );
            expect(warnMismatch).toContain('已提交封面的素材身份与所选不一致');
        });

        test('insertAudioMaterial handles success, match error, ambiguous, nobox, verify and throws', async () => {
            const makeAudioPage = (options: {
                matchResult?: string | (() => string);
                insertResult?: boolean;
                verifyResult?: string | (() => string);
                throwsOnPress?: boolean;
                noUploadControl?: boolean;
                skipUploadCover?: boolean;
            }) =>
                ({
                    evaluate: async (script: string) => {
                        if (
                            script.includes('insertaudio') ||
                            script.includes('music_plugin') ||
                            script.includes('focus')
                        )
                            return undefined;
                        if (script.includes('我已阅读并同意') || script.includes('js_agree')) return 'checked';
                        if (script.includes('audio_dialog') || script.includes('selectionchange')) return undefined;
                        if (script.includes('audio_item')) {
                            if (typeof options.matchResult === 'function') return options.matchResult();
                            return options.matchResult ?? JSON.stringify({ state: 'checked', identity: 'audio-id-1' });
                        }
                        if (script.includes('插入') && script.includes('button')) {
                            return options.insertResult ?? true;
                        }
                        if (script.includes('mp-common-mpaudio')) {
                            if (typeof options.verifyResult === 'function') return options.verifyResult();
                            return options.verifyResult ?? JSON.stringify({ state: 'top', identity: 'audio-id-1' });
                        }
                        return undefined;
                    },
                    press: async () => {
                        if (options.throwsOnPress) throw new Error('press error');
                    },
                    setInputFiles: async () => undefined,
                    waitForTimeout: async () => undefined,
                    locator: (sel: string) => {
                        if (options.noUploadControl && sel.includes('上传音频')) {
                            return { count: async () => 0 };
                        }
                        if (options.skipUploadCover && sel.includes('上传封面')) {
                            return { count: async () => 0 };
                        }
                        return {
                            count: async () => 1,
                            first: () => ({
                                count: async () => 1,
                                isVisible: async () => true,
                                waitFor: async () => undefined,
                                click: async () => undefined,
                                fill: async () => undefined,
                            }),
                        };
                    },
                }) as unknown as WechatPage;

            // 1. Success case
            const pageOk = makeAudioPage({});
            const { warning: resOk } = await insertAudioMaterial(pageOk, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resOk).toBe('');

            // 2. Match throws
            const pageMatchThrows = makeAudioPage({
                matchResult: () => {
                    throw new Error('match probe failed');
                },
            });
            const { warning: resMatchThrows } = await insertAudioMaterial(pageMatchThrows, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resMatchThrows).toContain('素材匹配探测失败');

            // 3. Ambiguous match
            const pageAmbiguous = makeAudioPage({
                matchResult: JSON.stringify({ state: 'ambiguous' }),
            });
            const { warning: resAmbiguous } = await insertAudioMaterial(pageAmbiguous, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resAmbiguous).toContain('列表匹配到多个同名条目');

            // 4. Nobox match
            const pageNobox = makeAudioPage({
                matchResult: JSON.stringify({ state: 'nobox' }),
            });
            const { warning: resNobox } = await insertAudioMaterial(pageNobox, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resNobox).toContain('行没有勾选框');

            // 5. Unchecked match
            const pageUnchecked = makeAudioPage({
                matchResult: JSON.stringify({ state: 'unchecked' }),
            });
            const { warning: resUnchecked } = await insertAudioMaterial(pageUnchecked, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resUnchecked).toContain('未选中');

            // 6. Invalid JSON match
            const pageInvalidJson = makeAudioPage({
                matchResult: 'invalid-json',
            });
            const { warning: resInvalid } = await insertAudioMaterial(pageInvalidJson, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resInvalid).toContain('素材匹配探测返回未知结果');

            // 7. Insert button not found
            const pageInsertFail = makeAudioPage({
                insertResult: false,
            });
            const { warning: resInsertFail } = await insertAudioMaterial(pageInsertFail, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resInsertFail).toContain('插入按钮未找到');

            // 8. Verify invalid JSON
            const pageVerifyInvalid = makeAudioPage({
                verifyResult: 'invalid-json',
            });
            const { warning: resVerifyInvalid } = await insertAudioMaterial(pageVerifyInvalid, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resVerifyInvalid).toContain('已插入但无法读取正文状态');

            // 9. Verify absent
            const pageVerifyAbsent = makeAudioPage({
                verifyResult: JSON.stringify({ state: 'absent' }),
            });
            const { warning: resVerifyAbsent } = await insertAudioMaterial(pageVerifyAbsent, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resVerifyAbsent).toContain('插入未生效');

            // 10. Verify not top
            const pageVerifyMiddle = makeAudioPage({
                verifyResult: JSON.stringify({ state: 'middle' }),
            });
            const { warning: resVerifyMiddle } = await insertAudioMaterial(pageVerifyMiddle, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resVerifyMiddle).toContain('已插入但未在文首');

            // 11. Verify identity mismatch
            const pageVerifyMismatch = makeAudioPage({
                verifyResult: JSON.stringify({ state: 'top', identity: 'different-id' }),
            });
            const { warning: resVerifyMismatch } = await insertAudioMaterial(pageVerifyMismatch, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resVerifyMismatch).toContain('无法核对素材身份');

            // 12. Throws on press
            const pageThrows = makeAudioPage({
                throwsOnPress: true,
            });
            const { warning: resThrows } = await insertAudioMaterial(pageThrows, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resThrows).toContain('press error');

            // 13. Match missing -> uploadControl not found
            const pageMissingUploadNotFound = makeAudioPage({
                matchResult: 'missing',
                noUploadControl: true,
            });
            const { warning: resMissingUpload } = await insertAudioMaterial(pageMissingUploadNotFound, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resMissingUpload).toContain('上传音频 control not found');

            // 14. Match missing -> upload succeeds -> match still missing
            let missingCallCount = 0;
            const pageMissingUploadSucceeds = makeAudioPage({
                matchResult: () => {
                    missingCallCount++;
                    return 'missing';
                },
                skipUploadCover: true,
            });
            const { warning: resMissingUploadSucceeds } = await insertAudioMaterial(pageMissingUploadSucceeds, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resMissingUploadSucceeds).toContain('保存后素材列表未出现「Episode 1」');
            expect(missingCallCount).toBeGreaterThan(0);

            // 15. Match missing -> upload succeeds -> match probe throws
            let errorCallCount = 0;
            const pageMissingUploadProbeThrows = makeAudioPage({
                matchResult: () => {
                    errorCallCount++;
                    if (errorCallCount > 3) throw new Error('probe throws on retry');
                    return 'missing';
                },
                skipUploadCover: true,
            });
            const { warning: resMissingUploadProbeThrows } = await insertAudioMaterial(pageMissingUploadProbeThrows, {
                title: 'Episode 1',
                audioPath: 'a.mp3',
                coverPath: 'c.png',
            });
            expect(resMissingUploadProbeThrows).toContain('保存后素材匹配探测失败');
        });

        test('flow.ts additional helper functions and branches', async () => {
            // 1. coverAssetIdentity: catch block for invalid URL and qpic stripping
            expect(coverAssetIdentity('not-a-valid-url')).toBe('not-a-valid-url');
            expect(coverAssetIdentity('https://mmbiz.qpic.cn/mmbiz_png/abc/640')).toBe('mmbiz.qpic.cn/mmbiz_png/abc');
            expect(coverAssetIdentity('https://example.com/image.png')).toBe('https://example.com/image.png');

            // 2. parsePublicDraftSnapshot: via readPublicDraftSnapshot
            const mockPageSnapshotOk = {
                evaluate: async () =>
                    JSON.stringify({
                        title: 'Test Title',
                        body: 'Test Body',
                        media: ['m1', 'm2'],
                        cover: 'c1',
                        originalUrl: 'https://example.com',
                    }),
            } as unknown as WechatPage;
            const snapOk = await readPublicDraftSnapshot(mockPageSnapshotOk);
            expect(snapOk?.title).toBe('Test Title');
            expect(snapOk?.media).toEqual(['m1', 'm2']);

            const mockPageSnapshotInvalid = {
                evaluate: async () =>
                    JSON.stringify({
                        title: 'Test Title',
                        body: 'Test Body',
                        media: [123],
                        cover: 'c1',
                    }),
            } as unknown as WechatPage;
            expect(await readPublicDraftSnapshot(mockPageSnapshotInvalid)).toBeNull();

            const mockPageSnapshotCatch = {
                evaluate: async () => {
                    throw new Error('eval error');
                },
            } as unknown as WechatPage;
            expect(await readPublicDraftSnapshot(mockPageSnapshotCatch)).toBeNull();

            // 3. readPublishNotifySubscribers
            const mockPageNotifyTrue = {
                evaluate: async () => true,
            } as unknown as WechatPage;
            expect(await readPublishNotifySubscribers(mockPageNotifyTrue)).toBe(true);

            const mockPageNotifyFalse = {
                evaluate: async () => false,
            } as unknown as WechatPage;
            expect(await readPublishNotifySubscribers(mockPageNotifyFalse)).toBe(false);

            const mockPageNotifyNull = {
                evaluate: async () => 'not-boolean',
            } as unknown as WechatPage;
            expect(await readPublishNotifySubscribers(mockPageNotifyNull)).toBeNull();

            const mockPageNotifyCatch = {
                evaluate: async () => {
                    throw new Error('eval error');
                },
            } as unknown as WechatPage;
            expect(await readPublishNotifySubscribers(mockPageNotifyCatch)).toBeNull();

            // 4. shouldNotifySubscribers
            expect(shouldNotifySubscribers({ title: 't', body: 'b', format: 'markdown' })).toBe(true);
            expect(
                shouldNotifySubscribers({
                    title: 't',
                    body: 'b',
                    format: 'markdown',
                    metadata: { wechatmp: null as unknown as Record<string, unknown> },
                }),
            ).toBe(true);
            expect(
                shouldNotifySubscribers({
                    title: 't',
                    body: 'b',
                    format: 'markdown',
                    metadata: { wechatmp: [] as unknown as Record<string, unknown> },
                }),
            ).toBe(true);
            expect(
                shouldNotifySubscribers({
                    title: 't',
                    body: 'b',
                    format: 'markdown',
                    metadata: { wechatmp: { notifySubscribers: false } },
                }),
            ).toBe(false);
            expect(
                shouldNotifySubscribers({
                    title: 't',
                    body: 'b',
                    format: 'markdown',
                    metadata: { wechatmp: { notifySubscribers: true } },
                }),
            ).toBe(true);

            // 5. readTitleMirror catch closure (line 653)
            const throwingMirrorPage = {
                locator: () => {
                    throw new Error('sync locator throw inside trySelectors');
                },
            } as unknown as WechatPage;
            const mirrorRes = await readTitleMirror(throwingMirrorPage);
            expect(mirrorRes).toEqual({ observed: false, value: '' });

            // 6. enrichArticleDraft with failing audio & library cover
            const audioFailPage = {
                evaluate: async () => {
                    throw new Error('fail evaluate');
                },
                locator: () => ({
                    count: async () => 0,
                    first: () => ({ isVisible: async () => false }),
                }),
            } as unknown as WechatPage;
            const contentWithAudio: Content = {
                title: 'Audio Title',
                body: 'body',
                format: 'markdown',
                metadata: {
                    wechatmp: {
                        coverSource: 'library',
                        audioTitle: 'Audio Ep',
                        audioPath: 'ep.mp3',
                        audioCoverPath: 'ep.png',
                    },
                },
            };
            const enrichRes = await enrichArticleDraft(audioFailPage, contentWithAudio, 100);
            expect(enrichRes.enrichWarnings.length).toBeGreaterThan(0);
            expect(enrichRes.coverWarnings).toContain('cover: 音频上传未成功且图片库尚无请求封面，已跳过图片库封面');

            // 7. applyLayout branches
            const mockPageLayout = {
                locator: (sel: string) => {
                    const isControl = sel.includes('一键排版');
                    return {
                        first: () => ({
                            isVisible: async () => isControl,
                            count: async () => (isControl ? 1 : 0),
                            click: async () => undefined,
                        }),
                        count: async () => (isControl ? 1 : 0),
                    };
                },
                click: async () => undefined,
                evaluate: async () => 'invalid-json',
            } as unknown as WechatPage;

            const depsMorePages = {
                stepTimeoutMs: 50,
                pollMs: 10,
                draftTimeoutMs: 50,
                submitSettleMs: 10,
                publishStatus: 'draft',
                content: { title: 't', body: 'b', format: 'markdown' },
                pages: () => [mockPageLayout, mockPageLayout],
            } as unknown as ModeRunDeps;
            // A control that opens nothing is a warning (the pasted body stands), never a failure.
            expect(await applyLayout(mockPageLayout, depsMorePages)).toContain('no recognized apply action');

            let pageCallCount = 0;
            const depsOpenTab = {
                stepTimeoutMs: 50,
                pollMs: 10,
                draftTimeoutMs: 50,
                submitSettleMs: 10,
                publishStatus: 'draft',
                content: { title: 't', body: 'b', format: 'markdown' },
                pages: () => {
                    pageCallCount++;
                    return pageCallCount <= 1 ? [mockPageLayout] : [mockPageLayout, mockPageLayout];
                },
            } as unknown as ModeRunDeps;
            expect(await applyLayout(mockPageLayout, depsOpenTab)).toContain('preview tab opened');

            const mockPageLayoutOptionThrow = {
                locator: (sel: string) => {
                    const isControl = sel.includes('一键排版');
                    const isOption = sel.includes('匹配目标格式');
                    const active = isControl || isOption;
                    return {
                        first: () => ({
                            isVisible: async () => active,
                            count: async () => (active ? 1 : 0),
                            click: async () => {
                                if (isOption) throw new Error('option click failed');
                            },
                        }),
                        count: async () => (active ? 1 : 0),
                    };
                },
                click: async (sel: string) => {
                    if (sel.includes('匹配目标格式')) throw new Error('option click failed');
                },
                evaluate: async () => 'invalid-json',
            } as unknown as WechatPage;
            const depsOptionThrow = {
                stepTimeoutMs: 50,
                pollMs: 10,
                draftTimeoutMs: 50,
                submitSettleMs: 10,
                publishStatus: 'draft',
                content: { title: 't', body: 'b', format: 'markdown' },
                pages: () => [mockPageLayoutOptionThrow],
            } as unknown as ModeRunDeps;
            const applyRes = await applyLayout(mockPageLayoutOptionThrow, depsOptionThrow);
            expect(applyRes).toContain('一键排版: 匹配目标格式 not applied');

            // 8. savePublicDraft unreadable snapshot & missing saveDraftAndWait
            const mockEntryNoSnapshot = {
                editor: {
                    evaluate: async () => null,
                } as unknown as WechatPage,
                operation: '文章',
                path: 'menu' as const,
                createType: 0,
            };
            const saveResNoSnapshot = await savePublicDraft(
                {} as unknown as ModeRunDeps,
                mockEntryNoSnapshot as unknown as Parameters<typeof savePublicDraft>[1],
            );
            expect('ok' in saveResNoSnapshot && saveResNoSnapshot.ok).toBe(false);
            expect('error' in saveResNoSnapshot && (saveResNoSnapshot as { error: string }).error).toContain(
                'the composed editor snapshot (title/body/media/cover) was unreadable',
            );

            const mockEntryNoSaveAndWait = {
                editor: {
                    evaluate: async (expr: string) => {
                        if (expr.includes('weui-desktop-dialog')) return false;
                        return JSON.stringify({
                            title: 'T',
                            body: 'B',
                            media: [],
                            cover: 'C',
                        });
                    },
                    url: () => 'https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&appmsgid=100',
                    locator: () => ({
                        count: async () => 1,
                        first: () => ({
                            count: async () => 1,
                            isVisible: async () => true,
                        }),
                    }),
                } as unknown as WechatPage,
                operation: '文章',
                path: 'menu' as const,
                createType: 0,
            };
            const depsNoSaveAndWait = {
                content: { title: 'T', body: 'B', format: 'markdown' },
                stepTimeoutMs: 50,
                submitSettleMs: 10,
            } as unknown as ModeRunDeps;
            const saveResNoSaveAndWait = await savePublicDraft(
                depsNoSaveAndWait,
                mockEntryNoSaveAndWait as unknown as Parameters<typeof savePublicDraft>[1],
            );
            expect('ok' in saveResNoSaveAndWait && saveResNoSaveAndWait.ok).toBe(false);
            expect('error' in saveResNoSaveAndWait && (saveResNoSaveAndWait as { error: string }).error).toContain(
                'native 保存为草稿 acknowledgement probe was unavailable',
            );

            // 9. confirmPublicPublish: switch did not remain verifiably OFF
            let notifyCallCount = 0;
            const mockPageSwitchFails = {
                evaluate: async () => {
                    notifyCallCount++;
                    return notifyCallCount > 1;
                },
                locator: () => ({
                    count: async () => 1,
                    first: () => ({
                        count: async () => 1,
                        isVisible: async () => true,
                        click: async () => undefined,
                    }),
                }),
                click: async () => undefined,
            } as unknown as WechatPage;
            const confirmRes = await confirmPublicPublish(mockPageSwitchFails, false, 50, 10);
            expect('ok' in confirmRes && confirmRes.ok).toBe(false);
            expect('error' in confirmRes && (confirmRes as { error: string }).error).toContain(
                '群发通知 switch did not verify OFF',
            );

            // 10. publishContent without saved evidence and stale refusal
            const mockPageStaleNoSaved = {
                url: () => 'https://mp.weixin.qq.com',
                evaluate: async () => '版本过期',
                locator: (sel: string) => {
                    if (sel.includes('当前编辑的草稿不是最新版本')) {
                        return {
                            count: async () => 1,
                            first: () => ({
                                count: async () => 1,
                                isVisible: async () => true,
                                click: async () => undefined,
                                textContent: async () => '当前编辑的草稿不是最新版本',
                            }),
                        };
                    }
                    if (sel.includes('h3.weui-desktop-dialog__title') || sel.includes('weui-desktop-dialog')) {
                        return {
                            count: async () => 0,
                            first: () => ({
                                count: async () => 0,
                                isVisible: async () => false,
                                click: async () => undefined,
                                textContent: async () => '',
                            }),
                        };
                    }
                    return {
                        count: async () => 1,
                        first: () => ({
                            count: async () => 1,
                            isVisible: async () => true,
                            click: async () => undefined,
                            textContent: async () => '',
                        }),
                    };
                },
                click: async () => undefined,
            } as unknown as WechatPage;
            const entryStaleNoSaved = {
                editor: mockPageStaleNoSaved,
                operation: '贴图',
                path: 'menu',
            };
            const depsStaleNoSaved = {
                content: { title: 'T', body: 'B', format: 'markdown' },
                stepTimeoutMs: 50,
                pollMs: 10,
                submitSettleMs: 10,
                pages: () => [mockPageStaleNoSaved],
            } as unknown as ModeRunDeps;
            const composedEmpty = {
                warnings: [],
                enrichWarnings: [],
                titlePath: 'mirror-agreed' as const,
            };
            const pubResStale = await publishContent(
                {
                    operation: '贴图',
                    content: { title: 'T', body: 'B', format: 'markdown' },
                } as unknown as Parameters<typeof publishContent>[0],
                depsStaleNoSaved,
                entryStaleNoSaved as unknown as Parameters<typeof publishContent>[2],
                composedEmpty,
            );
            expect(pubResStale.ok).toBe(false);
            expect(pubResStale.error).toContain('no canonical saved-editor evidence was available for recovery');

            // 11. waitForPublicEditorReadiness (success & evaluate throws)
            const mockPageReadySuccess = {
                evaluate: async () => 'saved',
            } as unknown as WechatPage;
            const readySuccess = await waitForPublicEditorReadiness(mockPageReadySuccess, {
                stepTimeoutMs: 100,
                pollMs: 10,
            } as unknown as ModeRunDeps);
            expect(readySuccess).toBe(true);

            const mockPageReadyThrow = {
                evaluate: async () => {
                    throw new Error('evaluate failure');
                },
            } as unknown as WechatPage;
            const readyFail = await waitForPublicEditorReadiness(mockPageReadyThrow, {
                stepTimeoutMs: 50,
                pollMs: 10,
            } as unknown as ModeRunDeps);
            expect(readyFail).toBe(false);

            // 12. confirmPublicPublish when notify switch fails to verify OFF at final publish check
            let notifyStateProbeCount = 0;
            const mockPageNotifyFailsAtEnd = {
                evaluate: async () => {
                    notifyStateProbeCount += 1;
                    // First before check: true. Off check: false. Final check: true (reverted!).
                    return notifyStateProbeCount !== 2;
                },
                locator: () => ({
                    count: async () => 1,
                    first: () => ({
                        count: async () => 1,
                        isVisible: async () => true,
                        click: async () => undefined,
                    }),
                }),
                click: async () => undefined,
            } as unknown as WechatPage;
            const confirmRevertRes = await confirmPublicPublish(mockPageNotifyFailsAtEnd, false, 50, 10);
            expect('ok' in confirmRevertRes && confirmRevertRes.ok).toBe(false);
            expect('error' in confirmRevertRes && (confirmRevertRes as { error: string }).error).toContain(
                '群发通知 switch did not remain verifiably OFF',
            );

            // 13. recoverStaleVersion branches
            const validCanonicalUrl = 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&appmsgid=10001';
            const savedEvidence = {
                saveControl: 'button:has-text("保存为草稿")',
                canonicalUrl: validCanonicalUrl,
                canonicalUrlForMetadata: validCanonicalUrl,
                saveSignal: 'persisted-snapshot' as const,
                snapshot: {
                    title: 'Title',
                    body: 'Body',
                    media: [],
                    cover: 'https://mmbiz.qpic.cn/test/0',
                    originalUrl: '',
                },
            };
            const mockEntryForRecovery = {
                editor: {
                    url: () => validCanonicalUrl,
                    locator: (sel: string) => ({
                        count: async () => (sel.includes('查看新草稿') ? 1 : 0),
                        first: () => ({
                            count: async () => (sel.includes('查看新草稿') ? 1 : 0),
                            isVisible: async () => sel.includes('查看新草稿'),
                            click: async () => undefined,
                        }),
                    }),
                    evaluate: async (script: string) => {
                        if (script.includes('title')) {
                            return {
                                title: 'Title',
                                body: 'Body',
                                media: [],
                                cover: 'https://mmbiz.qpic.cn/test/0',
                                originalUrl: '',
                            };
                        }
                        return 'saved';
                    },
                } as unknown as WechatPage,
                operation: '文章',
                path: 'menu' as const,
                createType: 0,
            };
            const depsForRecovery = {
                pages: () => [mockEntryForRecovery.editor],
                stepTimeoutMs: 50,
                pollMs: 10,
                draftTimeoutMs: 100,
            } as unknown as ModeRunDeps;

            // Non-canonical saved url fails immediately
            const invalidSaved = { ...savedEvidence, canonicalUrl: 'https://example.com' };
            const recNonCanonical = await recoverStaleVersion(depsForRecovery, mockEntryForRecovery, invalidSaved);
            expect('ok' in recNonCanonical && recNonCanonical.ok).toBe(false);

            // Success path of recoverStaleVersion
            const recSuccess = await recoverStaleVersion(depsForRecovery, mockEntryForRecovery, savedEvidence);
            expect('editor' in recSuccess).toBe(true);

            // recoverStaleVersion click throws
            const mockEntryClickThrows = {
                ...mockEntryForRecovery,
                editor: {
                    ...mockEntryForRecovery.editor,
                    click: async () => {
                        throw new Error('click failure');
                    },
                } as unknown as WechatPage,
            };
            const recClickFail = await recoverStaleVersion(depsForRecovery, mockEntryClickThrows, savedEvidence);
            expect('ok' in recClickFail && recClickFail.ok).toBe(false);

            // recoverStaleVersion differences in snapshot
            const mockEntryDiff = {
                ...mockEntryForRecovery,
                editor: {
                    ...mockEntryForRecovery.editor,
                    evaluate: async (script: string) => {
                        if (script.includes('title')) {
                            return {
                                title: 'Different Title',
                                body: 'Body',
                                media: [],
                                cover: 'https://mmbiz.qpic.cn/test/0',
                                originalUrl: '',
                            };
                        }
                        return 'saved';
                    },
                } as unknown as WechatPage,
            };
            const recDiff = await recoverStaleVersion(depsForRecovery, mockEntryDiff, savedEvidence);
            expect('ok' in recDiff && recDiff.ok).toBe(false);

            // 14. savePublicDraft success path
            const mockPageSaveSuccess = {
                url: () => validCanonicalUrl,
                saveDraftAndWait: async () => undefined,
                goto: async () => undefined,
                locator: (sel: string) => {
                    const isSaveDraft = sel.includes('保存为草稿');
                    return {
                        count: async () => (isSaveDraft ? 1 : 0),
                        first: () => ({
                            count: async () => (isSaveDraft ? 1 : 0),
                            isVisible: async () => isSaveDraft,
                            click: async () => undefined,
                        }),
                    };
                },
                evaluate: async (script: string) => {
                    if (script.includes('title')) {
                        return {
                            title: 'Title',
                            body: 'Body',
                            media: [],
                            cover: 'https://mmbiz.qpic.cn/test/0',
                            originalUrl: '',
                        };
                    }
                    if (script.includes('weui-desktop-dialog')) return false;
                    return 'saved';
                },
            } as unknown as WechatPage;
            const entrySaveSuccess = {
                editor: mockPageSaveSuccess,
                operation: '文章',
                path: 'menu' as const,
                createType: 0,
            };
            const depsSaveSuccess = {
                content: {
                    title: 'Title',
                    body: 'Body',
                    format: 'markdown',
                    metadata: { wechatmp: { cover: 'https://mmbiz.qpic.cn/test/0' } },
                },
                stepTimeoutMs: 50,
                pollMs: 10,
                draftTimeoutMs: 100,
            } as unknown as ModeRunDeps;
            const saveDraftRes = await savePublicDraft(depsSaveSuccess, entrySaveSuccess);
            expect('canonicalUrl' in saveDraftRes).toBe(true);
            if ('canonicalUrl' in saveDraftRes) {
                expect(saveDraftRes.canonicalUrl).toBe(validCanonicalUrl);
            }

            // savePublicDraft with content mismatch
            const mockPageSaveDiff = {
                ...mockPageSaveSuccess,
                evaluate: async (script: string) => {
                    if (script.includes('title')) {
                        return {
                            title: 'Mismatched Title',
                            body: 'Body',
                            media: [],
                            cover: 'https://mmbiz.qpic.cn/test/0',
                            originalUrl: '',
                        };
                    }
                    if (script.includes('weui-desktop-dialog')) return false;
                    return 'saved';
                },
            } as unknown as WechatPage;
            const saveDraftDiffRes = await savePublicDraft(depsSaveSuccess, {
                ...entrySaveSuccess,
                editor: mockPageSaveDiff,
            });
            expect('ok' in saveDraftDiffRes && saveDraftDiffRes.ok).toBe(false);

            // 15. runMode error catch formats carried open dialogs on save failure
            await seedMedia();
            const consoleThrow = makeConsole(
                happyState({
                    mode: '贴图',
                    createType: 8,
                    dialogOpen: true,
                    dialogCloseable: false,
                    saveClickThrows: true,
                }),
            );
            const contentSticker = mediaContent({ operation: '贴图', images: [bodyImage] });
            const resThrow = await makeTransport(consoleThrow).publish({ content: contentSticker });
            expect(resThrow.ok).toBe(false);
            expect(resThrow.error).toContain('residual modal refused cleanup');
            expect(resThrow.error).toContain('插入音频 上传音频');
        });
    });
});
