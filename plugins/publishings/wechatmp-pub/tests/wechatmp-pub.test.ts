import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';
import * as tsBrowserAutomation from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import { enrichArticle } from '../src/enrich';
import { insertAudioMaterial } from '../src/flow';
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

const tmpRoot = join(process.cwd(), '.tmp-test-wechat');
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
    body: '# 今日头条\n\n模型发布 **重点** 摘要。\n\n```ts\nconst x = 1;\n```',
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
    /** The 视频/播客 media modal is satisfied (the save bar exists only then, §5.1). */
    mediaSatisfied: boolean;
    /** The title block's typed text reaches the hidden `textarea#title` mirror (§5.2 trap 1). */
    mirrorFollows: boolean;
    /** The 草稿箱 `更新于` stamp shown for this run's title. */
    draftStamp: string | null;
    /** A save click refreshes that stamp — the observed draft signal. */
    saveMovesStamp: boolean;
    /** What the platform answers after 发表. */
    publish: 'sent' | 'refused' | 'silent';
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
const isBodyBlock = (selector: string) => selector.includes('.ProseMirror') && !selector.includes('data-placeholder');
const isDigest = (selector: string) => selector.includes('js_description');
const isAuthor = (selector: string) => selector.includes('input#author') || selector.includes('js_author');
const isFileInput = (selector: string) => selector.includes('file') && selector.includes('type="file"');
const isModalScoped = (selector: string) => selector.includes('weui-desktop-dialog');
const isImageInput = (selector: string) => isFileInput(selector) && selector.includes('image/');
const isVideoInput = (selector: string) => isFileInput(selector) && selector.includes('accept*="video"');
const isAudioInput = (selector: string) => isFileInput(selector) && selector.includes('audio');
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
    selector.includes('js_edit_ori') ||
    selector.includes('js_can_reward') ||
    selector.includes('js_article_tags_label') ||
    selector.includes('js_url_checkbox') ||
    selector.includes('js_claim_source');
const isCoverOpener = (selector: string) =>
    selector.includes('js_cover_btn_area') || selector.includes('换一张') || selector.includes('修改');
const isCoverItem = (selector: string) => selector.includes('cover') && selector.includes(' li');
const isConfirm = (selector: string) =>
    selector.includes('确定') || selector.includes('确认') || selector.includes('完成');
const isVideoUpload = (selector: string) => selector.includes('本地上传');
const isPodcastUpload = (selector: string) => selector.includes('上传音频');
const isPodcastInsert = (selector: string) => selector.includes('插入');
// Not a publish *control*: the toast labels 发表成功 / …无法发表 also carry the word.
const isPublishControl = (selector: string) =>
    !selector.includes(':text(') && (selector.includes('mass_send') || selector.includes('发表'));
const successProbe = (selector: string) => /:text\("(发表成功|已发表)"\)/.exec(selector)?.[1];
const refusalProbe = (selector: string) =>
    /:text\("(内容不完整，无法发表|请补充封面图|未设置头像与名称|未设置头像和名称|公众号尚未实名)"\)/.exec(
        selector,
    )?.[1];

/** Records every driver call and scripts the console UI the flow reads back. */
function makeConsole(initial: ConsoleState) {
    const state: ConsoleState = { ...initial };
    const calls: Record<'entry' | 'editor', RecordedCall[]> = { entry: [], editor: [] };
    const closed: number[] = [];
    let editorPage: ReturnType<typeof makePage> | null = null;
    let mirrorValue = '';
    let pastedHtml = '';
    let pickerOpen = false;
    let coverPanelOpen = false;
    let layoutOpen = false;
    let uploads: string[] = [];

    const entryAttached = (selector: string): boolean => {
        const label = menuItemLabel(selector);
        if (label !== undefined) return state.menu.includes(label) && !state.menuClosed;
        if (isMenuOpener(selector)) return state.menuClosed;
        // The 草稿箱 row: only the console home shows it, and only for this run's title.
        if (isStampProbe(selector)) return state.draftStamp !== null;
        return false;
    };

    const editorAttached = (selector: string): boolean => {
        if (isStampProbe(selector)) return false; // the editor carries no 草稿箱 container
        const success = successProbe(selector);
        if (success !== undefined) return state.publish === 'sent';
        const refusal = refusalProbe(selector);
        if (refusal !== undefined) return state.publish === 'refused';
        if (isTitleBlock(selector) || isMirror(selector) || isDigest(selector) || isAuthor(selector)) return true;
        if (isBodyBlock(selector)) return true;
        if (isImageInput(selector)) return !isModalScoped(selector) || (state.mode === '播客' && pickerOpen);
        if (isVideoInput(selector)) return state.mode === '视频' && pickerOpen;
        if (isAudioInput(selector)) return state.mode === '播客' && pickerOpen;
        if (isSaveBar(selector)) return state.mode === '文章' || state.mode === '贴图' || state.mediaSatisfied;
        if (isLayoutControl(selector) || isLayoutTarget(selector)) return state.mode === '文章';
        if (isSettingsRow(selector)) return state.mode === '文章';
        if (isCoverOpener(selector) || isCoverFromContent(selector) || isCoverFromLibrary(selector)) return true;
        if (isCoverItem(selector)) return coverPanelOpen;
        if (isVideoUpload(selector)) return state.mode === '视频';
        if (isPodcastUpload(selector) || isPodcastInsert(selector)) return state.mode === '播客';
        if (isConfirm(selector)) {
            if (state.mode === '视频') return pickerOpen;
            if (coverPanelOpen) return true;
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
        let url = role === 'entry' ? state.entryUrl : editorUrlFor(modeCreateType());
        const attached = (selector: string): boolean => {
            if (role === 'entry') return entryAttached(selector);
            // A toast surface is only "visible" for the recorded outcome; the body never satisfies it.
            if (isToastProbe(selector) || isStampProbe(selector)) return editorAttached(selector);
            if (isFileInput(selector)) return editorAttached(selector);
            return editorAttached(selector);
        };
        const page: WechatPage = {
            goto: async (target) => {
                log.push({ op: 'goto', args: [target] });
                url = target;
            },
            url: () => url,
            locator: (selector) => {
                log.push({ op: 'locator', args: [selector] });
                return {
                    count: async () => (attached(selector) ? 1 : 0),
                    first: () => ({
                        count: async () => (attached(selector) ? 1 : 0),
                        // Upload inputs hide behind styled controls; everything else is "visible".
                        isVisible: async () => attached(selector) && !isFileInput(selector),
                        fill: async (text) => {
                            log.push({ op: 'fill', args: [selector, text] });
                        },
                        click: async () => {
                            log.push({ op: 'click', args: [selector] });
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
                if (expression.includes('ClipboardEvent')) {
                    pastedHtml = /setData\('text\/html',\s*(".*?")\);/.exec(expression)?.[1] ?? '';
                    return true;
                }
                if (expression.includes('a[href*="token="]')) return state.tokenLink ?? '';
                if (expression.includes('textContent')) return pastedHtml.length > 0 ? '正文' : '';
                return '';
            },
            waitForTimeout: async () => undefined,
            press: async () => undefined,
        };

        function applyClick(selector: string): void {
            if (menuItemLabel(selector) !== undefined) {
                if (state.opensNewTab) openEditor();
                return;
            }
            if (isMenuOpener(selector)) {
                state.menuClosed = false;
                return;
            }
            if (isSaveBar(selector)) {
                if (state.saveMovesStamp) state.draftStamp = FRESH_STAMP;
                return;
            }
            if (isLayoutControl(selector)) {
                layoutOpen = true;
                return;
            }
            if (isLayoutTarget(selector)) return;
            if (isSettingsRow(selector)) return;
            if (isCoverOpener(selector) || isCoverFromContent(selector) || isCoverFromLibrary(selector)) {
                coverPanelOpen = true;
                return;
            }
            if (isVideoUpload(selector) || isPodcastUpload(selector)) {
                pickerOpen = true;
                return;
            }
            if (isPodcastInsert(selector)) {
                state.mediaSatisfied = uploads.length >= 2;
                return;
            }
            if (isConfirm(selector)) {
                if (state.mode === '视频' && pickerOpen) state.mediaSatisfied = uploads.length > 0;
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
        pages: () => (editorPage === null ? [entry] : [entry, editorPage]),
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
    };
}

function editorUrlFor(createType: number | null): string {
    const base = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${TOKEN}&lang=zh_CN&timestamp=1`;
    return createType === null ? base : `${base}&createType=${createType}`;
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

        const live = makeConsole(happyState());
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
        expect(String(editor[layoutIndex + 1]?.args[0])).toContain('匹配目标格式');
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
    test('public: only an explicit publishStatus reaches 发表, and the platform refusal is relayed', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ publish: 'refused' }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('publish refused by wechatmp');
        expect(result.error).toContain('内容不完整，无法发表');
        const clicks = selectorsOf(console.calls.editor, 'click');
        expect(clicks.some(isPublishControl)).toBe(true);
        expect(clicks.some(isSaveBar)).toBe(false);
    });

    test('public: an observed success marker reports the live signal', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ publish: 'sent' }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.metadata?.publishSignal).toContain('sent:');
        expect(result.metadata?.publishControl).toContain('mass_send');
    });

    test('public: an unobserved outcome fails loud with the duplicate-publish warning', async () => {
        await seedMedia();
        const console = makeConsole(happyState({ publish: 'silent' }));
        const result = await makeTransport(console).publish({
            content: { ...ARTICLE, metadata: { ...ARTICLE.metadata, publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('state unknown');
        expect(result.error).toContain('could publish twice');
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
}

/** A seam-shaped recording page for the enrichment unit tests. */
function recordingPage(ops: string[], evalReturns: unknown[] = [], opts: RecordingOpts = {}): WechatPage {
    const broken = (selector: string) => opts.failOn !== undefined && selector.includes(opts.failOn);
    return {
        goto: async () => undefined,
        url: () => editorUrlFor(0),
        locator: (selector) => ({
            count: async () => 1,
            first: () => ({
                count: async () => 1,
                isVisible: async () => true,
                fill: async (text) => {
                    if (broken(selector)) throw new Error('detached row');
                    ops.push(`fill ${selector} = ${text}`);
                },
                click: async () => {
                    if (broken(selector)) throw new Error('detached row');
                    ops.push(`click ${selector}`);
                },
                type: async (text) => {
                    ops.push(`type ${selector} = ${text}`);
                },
                waitFor: async () => {
                    ops.push(`wait ${selector}`);
                },
                textContent: async () => '',
                inputValue: async () => '',
            }),
        }),
        setInputFiles: async (selector) => {
            ops.push(`files ${selector}`);
        },
        evaluate: async (expression) => {
            ops.push(expression.includes('js_insertaudio') ? 'open-audio-menu' : 'eval');
            return evalReturns.shift();
        },
        waitForTimeout: async () => {
            ops.push('pause');
        },
        press: async () => {
            ops.push('press');
        },
    };
}

describe('wechatmp-pub 文章 draft enrichment (metadata.wechatmp)', () => {
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
        expect(clicks).toContain('.setting-group__switch.js_edit_ori');
        expect(clicks).toContain('.allow_click_opr.js_article_tags_label');
        expect(clicks).toContain('#js_claim_source_area .frm_checkbox_label');
        expect(clicks.some((selector) => selector.includes('文字原创'))).toBe(true);
        expect(clicks.some((selector) => selector.includes('每日AI资讯'))).toBe(true);
        // 创作来源 is the operator's own stance, not the platform's AI-generation label.
        expect(clicks.some((selector) => selector.includes('个人观点，仅供参考'))).toBe(true);
        // 赞赏 opens alongside 原创 now (operator walk 2026-10-10).
        expect(clicks).toContain('.setting-group__switch.js_can_reward');
        const fills = console.calls.editor.filter((call) => call.op === 'fill').map((call) => String(call.args[1]));
        expect(fills).toContain('每日AI资讯');
    });

    test('a 原创 dialog that does not commit becomes a warning, not a false success', async () => {
        const ops: string[] = [];
        const warnings = await enrichArticle(recordingPage(ops, [false]), {
            original: true,
            author: '冰原奔狼',
        });
        expect(warnings).toEqual(['原创声明: dialog did not close — check the draft']);
        expect(ops).toContain('click button:has-text("取消")');
    });

    test('a 原创 dialog that commits leaves no warning', async () => {
        const ops: string[] = [];
        const warnings = await enrichArticle(recordingPage(ops, [true]), { original: true, author: '冰原奔狼' });
        expect(warnings).toEqual([]);
    });

    test('原文链接 fills the surfdash URL, and 赞赏 takes its account from 作者 when empty', async () => {
        const ops: string[] = [];
        // reward account empty → fill from 作者; the 赞赏 dialog closes; then 原文链接 commits.
        const warnings = await enrichArticle(recordingPage(ops, [true, true, true]), {
            reward: true,
            author: '冰原奔狼',
            originalUrl: 'https://surfing.salty.vip/zh/posts/20261010-ai-ai',
        });
        expect(warnings).toEqual([]);
        expect(ops).toContain('click .setting-group__switch.js_can_reward');
        expect(ops).toContain('click .allow_click_opr.js_url_checkbox');
        // The 赞赏账户 defaults from 作者; the URL lands in the 原文链接 dialog's field.
        expect(ops.some((op) => op.startsWith('fill ') && op.includes('冰原奔狼'))).toBe(true);
        expect(ops.some((op) => op.startsWith('fill ') && op.includes('surfing.salty.vip'))).toBe(true);
    });

    test('a creation-source choice that does not stick becomes a warning', async () => {
        const ops: string[] = [];
        const warnings = await enrichArticle(recordingPage(ops, [false]), { claimSource: '个人观点，仅供参考' });
        expect(warnings).toEqual(['创作来源: 未生效，请手动设置']);
    });

    test('insertAudioMaterial reuses the same-title 素材库 material and verifies placement at the top', async () => {
        const ops: string[] = [];
        const warning = await insertAudioMaterial(
            recordingPage(ops, [undefined, undefined, 'checked', true, 'top']),
            AUDIO_INPUT,
        );
        expect(warning).toBe('');
        expect(ops).toContain('open-audio-menu');
        expect(ops.filter((op) => op === 'pause')).toHaveLength(1);
        // A reused material uploads nothing.
        expect(ops.some((op) => op.startsWith('files '))).toBe(false);
    });

    test('insertAudioMaterial uploads the audio + cover when the 素材库 has no same-title material', async () => {
        const ops: string[] = [];
        const warning = await insertAudioMaterial(
            // caret, menu, 3× dedupe (the 素材库 rows stream in), agree, select-first, insert, verify.
            recordingPage(ops, [
                undefined,
                undefined,
                'missing',
                'missing',
                'missing',
                'checked',
                'checked',
                true,
                'top',
            ]),
            AUDIO_INPUT,
        );
        expect(warning).toBe('');
        // Both artifacts reach the form, and the service-rules box is ticked before 保存.
        const uploads = ops.filter((op) => op.startsWith('files '));
        expect(uploads).toHaveLength(2);
        expect(uploads[0]).toContain('audio');
        expect(uploads[1]).toContain('image/');
        expect(ops.filter((op) => op === 'open-audio-menu')).toHaveLength(1);
    });

    test('insertAudioMaterial reports an unticked service-rules box instead of silently saving', async () => {
        const ops: string[] = [];
        const warning = await insertAudioMaterial(
            recordingPage(ops, [undefined, undefined, 'missing', 'missing', 'missing', 'no-label']),
            AUDIO_INPUT,
        );
        expect(warning).toContain('服务规则勾选失败');
        expect(warning).toContain('no-label');
    });

    test('a step whose row keeps detaching is retried once, then warned and swept', async () => {
        const ops: string[] = [];
        const warnings = await enrichArticle(recordingPage(ops, [true], { failOn: 'js_article_tags_label' }), {
            collection: '每日AI资讯',
        });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('合集');
        expect(warnings[0]).toContain('detached row');
        // Two attempts, each followed by a dialog sweep, plus the rail's closing sweep.
        expect(ops.filter((op) => op === 'click button:has-text("取消")')).toHaveLength(3);
    });

    test('a step whose row detaches once succeeds on its retry without a warning', async () => {
        const ops: string[] = [];
        const page = recordingPage(ops, [true]);
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
            [[undefined, undefined, 'checked', false], '插入按钮未找到'],
            [[undefined, undefined, 'checked', true, 'absent'], '插入未生效'],
            [[undefined, undefined, 'checked', true, 'notop'], '未在文首'],
            [[undefined, undefined, 'checked', true, 'noeditor'], '插入未生效'],
        ];
        for (const [returns, expected] of cases) {
            const ops: string[] = [];
            const warning = await insertAudioMaterial(recordingPage(ops, returns), AUDIO_INPUT);
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
        const profileDir = join(process.cwd(), '.tmp-test-wechat-profile');
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
        const profileDir = join(process.cwd(), '.tmp-test-wechat-profile-flow');
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
});
