import { afterAll, afterEach, beforeEach, describe, expect, jest, setSystemTime, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Content, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    type ProfileLaunchRequest,
} from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import { type AutomationGuard, CAP_WINDOW_MS, createAutomationGuard } from '../src/automation-guard';
import {
    BODY_COUNTER_EXPR,
    collectionProbeExpr,
    derivePodcastBody,
    RISK_LEAVES_EXPR,
    readDraftBaseline,
    VERIFY_BODY_EXPR,
} from '../src/flow';
import {
    CREATOR_TAB_COUNT,
    clickCreatorTab,
    createShadowProbe,
    defaultLauncher,
    getPublishTransport,
    main,
    makeDefaultOpenPage,
    type OpenPage,
    processPublishIO,
    validatePublishInput,
    wrapPlaywrightPage,
    XhsBrowserTransport,
    type XhsLocator,
    type XhsOperation,
    type XhsPage,
} from '../src/index';
import { findAttachedSelector, findSelector } from '../src/page';
import { checkProfileSession, main as profileCheckMain } from '../src/profile-check';

// ADR-025: publish and explicit headed checks draw on a 2h-capped automation guard.
// `makeTransport` stubs the guard for flow tests; every browser is a scripted seam.
//  - the guard's state file is redirected to a temp path cleared before every test, so the caps
//    never leak between tests or write into the operator's ~/.config/kk.
const AUTOMATION_STATE = join(mkdtempSync(join(tmpdir(), 'kk-xhs-guard-')), 'state.json');
process.env.KK_XHS_AUTOMATION_STATE = AUTOMATION_STATE;

const clockSignal = new Int32Array(new SharedArrayBuffer(4));
let clockDriver: Promise<void>;

async function driveClock(): Promise<void> {
    while (jest.isFakeTimers()) {
        await Atomics.waitAsync(clockSignal, 0, 0, 4).value;
        if (jest.isFakeTimers()) jest.advanceTimersByTime(20);
    }
}

beforeEach(() => {
    // Atomics supplies a real-time tick while browser-console waits run on Bun's fake clock.
    jest.useFakeTimers();
    clockDriver = driveClock();
    rmSync(AUTOMATION_STATE, { force: true });
});

afterEach(async () => {
    jest.useRealTimers();
    await clockDriver;
});

/** The allow-all guard for tests that are not exercising the cap itself. */
const ALLOW_ALL: AutomationGuard = { allow: () => ({ allowed: true, reason: '' }), record: () => undefined };

/**
 * The publish path is guarded; tests opt into the real guard only when exercising its budget.
 */
function makeTransport(
    driver: 'script' | 'agent' = 'script',
    opts: ConstructorParameters<typeof XhsBrowserTransport>[1] = {},
): XhsBrowserTransport {
    return new XhsBrowserTransport(driver, { automation: ALLOW_ALL, ...opts });
}

const tmpRoot = join(process.cwd(), '.works/tmp/test-xhs');
// The scratch tree must not survive the run: an untracked directory created DURING a
// feature-verification pass changes the tree mid-pass and fails its evidence binding.
afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});
const img = (n: number) => join(tmpRoot, `card-${n}.png`);
const PROFILE = join(homedir(), '.config', 'kk', 'browser-profiles', 'xhs');

interface FakeState {
    loggedIn: boolean;
    thumbCount: number | null; // null = nothing uploaded yet
    uploadThumbCount: number | null; // override count set on upload (mismatch scripting)
    publishConfirm: boolean;
    publishedUrl: string | null;
    /** The console's own draft counter, read back as `草稿箱(N)`. */
    draftCount: number;
    /** When true the draft control is clicked but the counter never moves. */
    draftSaveIsSilent: boolean;
    /** A save that closes the editor but prints NO 保存于 entry (counter-only signal). */
    draftSaveStampsNothing: boolean;
    /** When false the closed-shadow publish bar exposes no control at all. */
    shadowBar: boolean;
    /** True while the image editor is open: the landing view's draft counter is gone. */
    inEditor: boolean;
    /** Set once a save prints a 保存于<timestamp> entry (the second confirmation signal). */
    draftSavedStamp: boolean;
    /** When true the counter is never readable, leaving the timestamp as the only signal. */
    counterUnreadable: boolean;
    /** The counter appears only after the first submit click (a save can expose it). */
    counterHiddenAtBaseline: boolean;
    /** Set after any draft-control click. */
    draftClicked: boolean;
    /** The console marks a completed publish in its own URL (`…published=true`). */
    publishUrlMarker: boolean;
    /** A container-scoped `保存成功` toast is showing (the signal the discovery measured). */
    draftToast: boolean;
    /** The pasted body carries the toast label, so an UNSCOPED `:text(…)` probe of it matches. */
    bodyContainsToastLabel: boolean;
    /** 写长文's in-page long-article editor is open (opened by `新的创作`). */
    articleOpen: boolean;
    /** The article body was inserted through a real paste (the shared helper's script ran). */
    articlePasted: boolean;
    /** The 发播客 modal is open and covers the action bar. */
    podcastModal: boolean;
    /** The cover card's click never opens the native file chooser (the measured failure case). */
    podcastCoverChooserSilent: boolean;
    podcastAudioAttached: boolean;
    /** Set once the image tab's centre click lands (the active tab's file input turns visible). */
    imageModeEntered?: boolean;
    /** When true a dropped batch never reaches the wire (the console never uploaded). */
    uploadNeverStarts?: boolean;
    podcastCoverAttached: boolean;
    /** When true some uploaded thumbnails still carry a local (blob) src — the upload is unfinished. */
    thumbLocalSrcs: boolean;
    /** When set, the visible `xhs-publish-btn` host exposes this save method (the closed-shadow bar). */
    hostSaveMethod: string | null;
    /** The last title filled into the editor (the counter/verify reads report it back). */
    editorTitle: string | null;
    /** Units the editor's body counter reports after the last typed body (2 half-width chars = 1). */
    editorBodyUnits: number | null;
    /** A scripted server response the capture layer reports (risk-control / biz-error scripting). */
    serverCapture: { source: string; text: string } | null;
    captureBodyNeverEnds?: boolean;
    captureBodyThrows?: boolean;
    /** Scripted platform-counter reads; null derives from the editor state. */
    counterTitleOverride: string | null;
    counterBodyOverride: string | null;
    /** verifyDraft scripting: the reopened draft disagrees with the composed content. */
    verifyTitleMismatch: boolean;
    verifySlotCount: number | null;
    verifyLocalSrcs: boolean;
    verifyBodyEmpty: boolean;
    verifyCollectionMissing: boolean;
    /** verifyDraft scripting: the draft box / its 编辑 control is unreachable. */
    draftNavMissing: boolean;
    draftEditMissing: boolean;
    /** verifyDraft scripting: the reopened editor never renders any content (TipTap never hydrates). */
    verifyEditorBlank: boolean;
}

/** Labels XHS uses for the draft control, inside the closed shadow publish bar. */
const DRAFT_LABELS = new Set(['暂存离开', '存草稿', '保存草稿']);

/** The toast labels the flows probe for; only `保存成功` is a draft signal. */
const TOAST_LABELS = ['保存成功', '发布成功', '已发布'];

/**
 * Tab-bar / modal / text-probe selectors the fake must answer specially. The console renders the
 * four mode tabs (`div.creator-tab`) plus, for every tab, an `aria-hidden` clone and an off-screen
 * clone — which is why the flows consult `countOnScreen` before clicking.
 */
const isModal = (selector: string) => selector.includes('creator-modal-sty') || selector.includes('d-modal');
const isDisabledProbe = (selector: string) => selector.includes('[disabled]') || selector.includes('aria-disabled');
const isTextProbe = (selector: string) => selector.includes(':text(');
const isPodcastAudioInput = (selector: string) =>
    selector.includes('accept*=".mp3"') || selector.includes('accept*=".wav"');
const isPodcastCoverInput = (selector: string) =>
    selector.includes('accept*=".jpg"') || selector.includes('accept*=".png"');

/** Records every driver call and scripts the UI state the flow observes. */
function makeFakePage(initial: FakeState) {
    // Own the state: tests reuse a module-level `happy` fixture and driver steps mutate it.
    const state: FakeState = { ...initial };
    const saveTimestamp = () => `保存于${new Date().toLocaleString('sv-SE').slice(0, 16)}`;
    // A saved timestamp stays fixed when the clock crosses a minute boundary.
    let savedStamp = state.draftSavedStamp ? saveTimestamp() : null;
    const calls: Array<{ op: string; args: unknown[] }> = [];
    let lastShadowLabel: string | null = null;
    const contextResponseHandlers = new Set<(payload: unknown) => void>();
    const consoleHandlers = new Set<(payload: unknown) => void>();
    let submitted = false;
    const emitOutcome = () => {
        submitted = true;
        const capture = state.serverCapture;
        if (capture === null || capture.source === 'toast') return;
        if (capture.source === 'console') {
            for (const handler of consoleHandlers) handler({ text: () => capture.text });
            return;
        }
        for (const handler of contextResponseHandlers) {
            handler({
                status: () => 200,
                url: () => 'https://creator.xiaohongshu.com/api/save',
                request: () => ({ resourceType: () => capture.source }),
                text: async () => {
                    if (state.captureBodyNeverEnds) await new Promise(() => {});
                    if (state.captureBodyThrows) throw new Error('response body unavailable');
                    await Bun.sleep(1);
                    return capture.text;
                },
            });
        }
    };
    let bodyTyped = false;
    // The counter lives on the landing view; the editor replaces the header.
    const counterAttached = () =>
        !state.counterUnreadable && !state.inEditor && !(state.counterHiddenAtBaseline && !state.draftClicked);
    const draftBoxText = () => (counterAttached() ? `草稿箱(${state.draftCount})` : '');
    /**
     * Whether a text probe finds its label. A CONTAINER-SCOPED probe only matches a scripted toast;
     * an UNSCOPED one also matches the editor body, which is exactly the false success the scoped
     * read exists to prevent (the body the flow itself pasted carries the label).
     */
    const toastFound = (selector: string): boolean => {
        const label = TOAST_LABELS.find((candidate) => selector.includes(candidate));
        if (label === undefined) return false;
        // `readScopedSignal` builds `<container> :text("label")`; an unscoped probe is bare.
        if (!selector.includes(' :text(')) return state.bodyContainsToastLabel;
        return label === '保存成功' ? state.draftToast : state.publishConfirm;
    };
    const isLiveThumb = (selector: string) => selector.includes('img.preivew-image');
    const isLegacyThumb = (selector: string) =>
        !isLiveThumb(selector) && selector.includes('img') && !selector.includes('file');
    const isFileInput = (selector: string) => selector.includes('file');
    const isEditor = (selector: string) => /contenteditable|ql-editor|post-textarea|ProseMirror/.test(selector);
    const isStamp = (selector: string) => selector.startsWith('text=保存于');
    const isDraftBox = (selector: string) => selector.includes('草稿箱');
    /**
     * Playwright's `count()` counts ATTACHED matches, hidden or not; only `isVisible()` filters on
     * visibility. The hidden upload inputs and the collapsed draft panel are attached throughout.
     */
    const attached = (selector: string): boolean => {
        if (!state.loggedIn) return false;
        if (isLiveThumb(selector)) return (state.thumbCount ?? 0) > 0;
        if (isLegacyThumb(selector)) return false;
        if (isEditor(selector)) return state.inEditor || state.articleOpen;
        if (isStamp(selector)) return selector === `text=${savedStamp}`;
        if (isDraftBox(selector))
            return state.loggedIn && !state.draftNavMissing && (counterAttached() || savedStamp !== null);
        if (selector === 'text=编辑') return state.loggedIn && !state.draftEditMissing;
        if (isTextProbe(selector)) return toastFound(selector);
        if (isModal(selector)) return state.podcastModal;
        // `去发布` enables only once both cards register; the disabled-state probe matches nothing
        // while the cards settle, and the enabled button itself is attached throughout.
        if (isDisabledProbe(selector)) return false;
        return true;
    };
    /** The upload inputs sit behind styled drop zones: attached but never "visible" — except the
     * ACTIVE tab's input once its mode is entered (2026-11-10 console rewires the upload widget). */
    const isVisible = (selector: string): boolean => {
        if (!attached(selector)) return false;
        if (isFileInput(selector)) return state.imageModeEntered === true;
        return true;
    };
    /** The editor only holds something to persist once content registered in it. */
    const savableContent = () =>
        bodyTyped || state.articlePasted || (state.podcastAudioAttached && state.podcastCoverAttached);
    /**
     * What a click on a draft control does. `暂存离开` dismisses the editor whether or not the save
     * registers, which is what makes the counter/stamp delta the only usable signal.
     */
    const applySaveClick = (label: string) => {
        if (label === '发布' || DRAFT_LABELS.has(label)) emitOutcome();
        if (!DRAFT_LABELS.has(label)) return;
        state.draftClicked = true;
        // Nothing to persist (an untyped TipTap body, an empty article) leaves the editor open.
        if (!savableContent()) return;
        state.inEditor = false;
        if (state.draftSaveIsSilent) return;
        state.draftCount += 1;
        if (!state.draftSaveStampsNothing) savedStamp = saveTimestamp();
    };
    const page: XhsPage = {
        goto: async (url) => {
            calls.push({ op: 'goto', args: [url] });
        },
        locator: (selector) => {
            calls.push({ op: 'locator', args: [selector] });
            // Faithful to the live console (task 0174): only the live preview class renders, the
            // legacy thumbnail classes match nothing, and note-editor selectors exist only once
            // the image editor is open — so a pre-upload editor wait is not satisfiable.
            return {
                count: async () => {
                    if (isLiveThumb(selector)) return state.thumbCount ?? 0;
                    return attached(selector) ? 1 : 0;
                },
                first: () => ({
                    count: async () => (attached(selector) ? 1 : 0),
                    isVisible: async () => isVisible(selector),
                    boundingBox: async () =>
                        attached(selector) && !isFileInput(selector)
                            ? { x: 410, y: 149, width: 460, height: 478 }
                            : null,
                    fill: async (text) => {
                        calls.push({ op: 'fill', args: [selector, text] });
                        // The title input's value is what the counter/verify reads report back
                        // (`input.d-text` is the podcast editor's title probe hit).
                        if (selector.includes('标题') || selector === 'input.d-text') state.editorTitle = text;
                    },
                    click: async () => {
                        calls.push({ op: 'click', args: [selector] });
                        // Light-DOM controls: the article editor, the podcast modal, `一键排版`,
                        // and 写长文's own `暂存离开` (which is NOT in the shadow bar).
                        const draftLabel = [...DRAFT_LABELS].find((label) => selector.includes(label));
                        if (draftLabel !== undefined) applySaveClick(draftLabel);
                        else if (selector.includes('发布') && !selector.includes('去发布')) emitOutcome();
                        if (selector.includes('新的创作')) state.articleOpen = true;
                        if (selector.includes('上传音频')) state.podcastModal = true;
                        if (selector.includes('去发布')) state.podcastModal = false;
                    },
                    type: async (text) => {
                        calls.push({ op: 'type', args: [selector, text] });
                        // TipTap only registers typed content in this model; the units echo is
                        // what the platform-counter probe reports back.
                        if (selector.includes('tiptap')) {
                            bodyTyped = true;
                            state.editorBodyUnits = Math.max(1, Math.ceil(text.length / 2));
                        }
                    },
                    textContent: async () => (isDraftBox(selector) ? draftBoxText() : ''),
                }),
            };
        },
        setInputFiles: async (selector, paths) => {
            // Playwright takes either one path or a list; the flows use both (one video, or a batch).
            const files = Array.isArray(paths) ? [...paths] : [paths];
            calls.push({ op: 'setInputFiles', args: [selector, files] });
            state.thumbCount = state.uploadThumbCount ?? files.length;
            // Measured live: the note editor (and its header swap) appears once an artifact is
            // uploaded, not when the tab is clicked — so a pre-upload editor wait is unsatisfiable.
            state.inEditor = true;
            if (state.podcastModal && isPodcastAudioInput(selector)) state.podcastAudioAttached = true;
            if (state.podcastModal && isPodcastCoverInput(selector)) state.podcastCoverAttached = true;
            // uploads land on the wire unless a test scripts a missed drop (uploadNeverStarts).
            if (state.uploadNeverStarts !== true) {
                for (let i = 0; i < files.length; i += 1) {
                    for (const handler of contextResponseHandlers) {
                        handler({ status: () => 200, url: () => `https://ros-upload.xiaohongshu.com/spectrum/${i}` });
                    }
                }
            }
        },
        onContextResponse: (handler) => {
            calls.push({ op: 'onContextResponse', args: [] });
            contextResponseHandlers.add(handler);
        },
        offContextResponse: (handler) => {
            calls.push({ op: 'offContextResponse', args: [] });
            contextResponseHandlers.delete(handler);
        },
        on: (event, handler) => {
            if (event === 'console') consoleHandlers.add(handler);
        },
        off: (event, handler) => {
            if (event === 'console') consoleHandlers.delete(handler);
        },
        waitForEvent: async (event, opts) => {
            calls.push({ op: 'waitForEvent', args: [event, opts?.timeout ?? null] });
            if (event !== 'filechooser') return null;
            if (state.podcastCoverChooserSilent) return null;
            return {
                setFiles: async (paths: readonly string[] | string) => {
                    const chooserFiles = Array.isArray(paths) ? [...paths] : [paths];
                    calls.push({ op: 'setInputFiles', args: ['filechooser', chooserFiles] });
                    // The chooser resolves a FILE, not a selector — a cover delivery through the
                    // chooser registers the card exactly like the audio's input assignment does.
                    if (state.podcastModal) state.podcastCoverAttached = true;
                },
            };
        },
        mouse: {
            click: async (x, y) => {
                calls.push({ op: 'mouse', args: [x, y] });
            },
        },
        evaluate: async (expression) => {
            calls.push({ op: 'evaluate', args: [expression] });
            if (expression.includes('kk-risk-leaves')) {
                return JSON.stringify(
                    submitted && state.serverCapture?.source === 'toast' ? [state.serverCapture.text] : [],
                );
            }
            // Task 0350: the flow's own read-back probes, dispatched by their sentinel markers.
            if (expression.includes('kk-counter-title')) {
                if (state.counterTitleOverride !== null) return state.counterTitleOverride;
                return state.editorTitle === null ? 'kk-counter-none' : `${Math.ceil(state.editorTitle.length / 2)}/20`;
            }
            if (expression.includes('kk-counter-body')) {
                if (state.counterBodyOverride !== null) return state.counterBodyOverride;
                return state.editorBodyUnits === null ? 'kk-counter-none' : `${state.editorBodyUnits}/1000`;
            }
            if (expression.includes('kk-verify-slots')) {
                return JSON.stringify({
                    count: state.verifyEditorBlank ? 0 : (state.verifySlotCount ?? state.thumbCount ?? 0),
                });
            }
            if (expression.includes('kk-verify-srcs')) {
                return JSON.stringify(
                    state.thumbLocalSrcs || state.verifyLocalSrcs
                        ? ['blob:local']
                        : Array.from({ length: state.thumbCount ?? 0 }, () => 'https://sns-img.qhupdate.com/x'),
                );
            }
            if (expression.includes('kk-verify-title')) {
                if (state.verifyEditorBlank) return '';
                return state.verifyTitleMismatch ? '别的标题' : (state.editorTitle ?? '');
            }
            if (expression.includes('kk-verify-body')) {
                if (state.verifyEditorBlank) return JSON.stringify({ textLen: 0 });
                if (state.verifyBodyEmpty) return JSON.stringify({ textLen: 0 });
                return state.editorBodyUnits !== null
                    ? JSON.stringify({ counter: `${state.editorBodyUnits}/1000` })
                    : JSON.stringify({ textLen: state.articlePasted ? 4 : 0 });
            }
            if (expression.includes('kk-verify-collection')) {
                return state.verifyCollectionMissing ? 'kk-verify-collection:no' : 'kk-verify-collection:yes';
            }
            if (expression.includes('kk-count-local-srcs')) return state.thumbLocalSrcs ? 1 : 0;
            if (expression.includes('kk-thumb-')) {
                const expected = Number(/imgs\.length < (\d+)/.exec(expression)?.[1] ?? 0);
                const countOk = (state.thumbCount ?? 0) >= expected;
                return countOk && !state.thumbLocalSrcs ? 'kk-thumb-all-durable' : 'kk-thumb-pending';
            }
            if (expression.includes('kk-host-save')) {
                if (state.hostSaveMethod !== null) applySaveClick('暂存离开');
                return state.hostSaveMethod === null ? 'kk-host-save-none' : `kk-host-save:${state.hostSaveMethod}`;
            }
            if (expression.includes('ClipboardEvent')) {
                state.articlePasted = true;
                return true;
            }
            // The shared paste helper's post-condition read: the editor reports its text.
            return state.articlePasted ? '长文正文' : '';
        },
        countOnScreen: async (selector) => {
            calls.push({ op: 'countOnScreen', args: [selector] });
            // The real bar mounts late and renders every tab as an `aria-hidden` clone plus an
            // off-screen clone; the fake reports all four on-screen tabs once authenticated.
            return state.loggedIn ? CREATOR_TAB_COUNT : 0;
        },
        waitForSelector: async () => null,
        url: () =>
            state.publishUrlMarker
                ? 'https://creator.xiaohongshu.com/publish/publish?source=&published=true'
                : state.publishConfirm && state.publishedUrl
                  ? state.publishedUrl
                  : 'https://creator.xiaohongshu.com/publish/publish',
        clickInViewport: async (selector) => {
            calls.push({ op: 'clickInViewport', args: [selector] });
            return state.loggedIn;
        },
        findShadowControl: async (labels) => {
            calls.push({ op: 'findShadowControl', args: [[...labels]] });
            if (!state.shadowBar) return null;
            const label = labels[0];
            if (label === undefined) return null;
            lastShadowLabel = label;
            return { label, x: 606, y: 855 };
        },
        clickAt: async (x, y) => {
            calls.push({ op: 'clickAt', args: [x, y] });
            if (lastShadowLabel === null) return;
            applySaveClick(lastShadowLabel);
        },
        boundingBoxesOnScreen: async (selector: string) => {
            calls.push({ op: 'boundingBoxesOnScreen', args: [selector] });
            if (state.loggedIn && attached(selector)) {
                if (selector === 'text=上传图文') state.imageModeEntered = true;
                return [{ x: 100, y: 200, width: 80, height: 30 }];
            }
            return [];
        },
    };
    return { page, calls, contextResponseHandlers, consoleHandlers };
}

function makeOpenPage(state: FakeState) {
    const closed: number[] = [];
    const callLogs: Array<Array<{ op: string; args: unknown[] }>> = [];
    const open: OpenPage = async () => {
        const fake = makeFakePage(state);
        callLogs.push(fake.calls);
        return { page: fake.page, close: async () => void closed.push(1) };
    };
    return { open, closed, calls: callLogs };
}

function cardContent(over: Partial<Content['metadata']> = {}, n = 2): Content {
    return {
        title: '测试卡片',
        body: '正文',
        format: 'markdown',
        metadata: { images: Array.from({ length: n }, (_, i) => ({ path: img(i) })), ...over },
    };
}

async function seedImages(n = 2): Promise<void> {
    await mkdir(tmpRoot, { recursive: true });
    await Promise.all(Array.from({ length: n }, (_, i) => writeFile(img(i), 'png')));
}

const video = join(tmpRoot, 'clip.mp4');
const audio = join(tmpRoot, 'episode.mp3');
const cover = join(tmpRoot, 'cover.png');

/** The artifacts the non-image modes upload, on disk so the pre-browser validation can read them. */
async function seedMedia(): Promise<void> {
    await mkdir(tmpRoot, { recursive: true });
    await Promise.all([writeFile(video, 'mp4'), writeFile(audio, 'mp3'), writeFile(cover, 'png')]);
}

function modeContent(metadata: Record<string, unknown>, over: Partial<Content> = {}): Content {
    return { title: '模式标题', body: '正文', format: 'markdown', metadata, ...over };
}

const happy: FakeState = {
    loggedIn: true,
    thumbCount: null,
    uploadThumbCount: null,
    publishConfirm: true,
    publishedUrl: 'https://www.xiaohongshu.com/explore/abc123',
    draftCount: 0,
    draftSaveIsSilent: false,
    draftSaveStampsNothing: false,
    shadowBar: true,
    inEditor: false,
    draftSavedStamp: false,
    counterUnreadable: false,
    counterHiddenAtBaseline: false,
    draftClicked: false,
    publishUrlMarker: false,
    draftToast: false,
    bodyContainsToastLabel: false,
    articleOpen: false,
    articlePasted: false,
    podcastModal: false,
    podcastCoverChooserSilent: false,
    podcastAudioAttached: false,
    podcastCoverAttached: false,
    thumbLocalSrcs: false,
    hostSaveMethod: null,
    editorTitle: null,
    editorBodyUnits: null,
    serverCapture: null,
    counterTitleOverride: null,
    counterBodyOverride: null,
    verifyTitleMismatch: false,
    verifySlotCount: null,
    verifyLocalSrcs: false,
    verifyBodyEmpty: false,
    verifyCollectionMissing: false,
    verifyEditorBlank: false,
    draftNavMissing: false,
    draftEditMissing: false,
};

describe('0370 — out-of-page capture and one headed visit', () => {
    test('AC1: every operation and mode leaves page globals untouched and disposes listeners', async () => {
        await seedImages();
        await seedMedia();
        const summary: Array<{ operation: string; mode: string; expressions: number; verdict: boolean }> = [];
        for (const operation of ['上传图文', '上传视频', '写长文', '发播客'] as const) {
            for (const mode of ['draft', 'public'] as const) {
                const fake = makeFakePage({
                    ...happy,
                    serverCapture: { source: 'xhr', text: '{"code":0,"note_id":"0370"}' },
                });
                const content = modeContent({
                    images: [{ path: img(0) }, { path: img(1) }],
                    video: { path: video },
                    audio: { path: audio },
                    coverImage: cover,
                    publishStatus: mode,
                });
                const result = await makeTransport('script', {
                    openPage: async () => ({ page: fake.page, close: async () => {} }),
                    stepTimeoutMs: 100,
                    submitSettleMs: 2,
                    submitAttempts: 1,
                }).publish({ content, options: { operation } });
                const expressions = fake.calls
                    .filter((entry) => entry.op === 'evaluate')
                    .map((entry) => String(entry.args[0]));
                summary.push({ operation, mode, expressions: expressions.length, verdict: result.ok });
                await Bun.write(
                    join(process.cwd(), '.works/tmp/test-xhs-capture/summary.json'),
                    JSON.stringify(summary, null, 2),
                );
                expect(expressions.join('\n')).not.toMatch(
                    /XMLHttpRequest|\.fetch\s*=|console\.\w+\s*=|prototype\.(open|send)/,
                );
                expect(result.ok).toBe(true);
                expect(result.metadata?.serverCapture).toEqual({
                    source: 'xhr',
                    verdict: 'ok',
                    code: '0',
                    noteId: '0370',
                });
                expect(fake.contextResponseHandlers.size).toBe(0);
                expect(fake.consoleHandlers.size).toBe(0);
            }
        }
        expect(summary).toHaveLength(8);
    }, 30_000);

    test('AC1: context responses delivered at the click override a successful UI and body reads settle', async () => {
        await seedImages();
        const fake = makeFakePage({ ...happy, serverCapture: { source: 'fetch', text: '{"code":-9136}' } });
        const result = await makeTransport('script', {
            openPage: async () => ({ page: fake.page, close: async () => {} }),
            stepTimeoutMs: 100,
            submitSettleMs: 1,
        }).publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('AccountRiskControlError');
        expect(fake.contextResponseHandlers.size).toBe(0);
        expect(fake.consoleHandlers.size).toBe(0);
    });

    test('AC2: one headed launch gates readiness with no preflight and consumes one visit', async () => {
        await seedImages();
        const requests: Array<{ profileDir: string; headless: boolean }> = [];
        const records: string[] = [];
        const fake = makeFakePage(happy);
        const launched = makeDefaultOpenPage(async (request) => {
            requests.push(request);
            return { pages: () => [{}], close: async () => {} };
        });
        const options = {
            openPage: async (profileDir: string) => {
                const visit = await launched(profileDir);
                return { ...visit, page: fake.page };
            },
            automation: {
                allow: () => ({ allowed: true, reason: '' }),
                record: (event: string) => {
                    records.push(event);
                },
            },
            preflight: async () => ({
                status: 'refused' as const,
                profileDir: PROFILE,
                detail: 'removed preflight must not run',
            }),
            stepTimeoutMs: 100,
            submitSettleMs: 1,
        };
        const result = await new XhsBrowserTransport('script', options).publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        expect(requests).toEqual([{ profileDir: PROFILE, headless: false }]);
        expect(records).toEqual(['publish']);
    });

    test('AC1: an unfinished body cannot hold a completed UI save past the capture budget', async () => {
        const fake = makeFakePage({
            ...happy,
            captureBodyNeverEnds: true,
            serverCapture: { source: 'fetch', text: '{"note_id":"never"}' },
        });
        const result = await Promise.race([
            makeTransport('script', {
                openPage: async () => ({ page: fake.page, close: async () => {} }),
                stepTimeoutMs: 20,
                submitSettleMs: 2,
            }).publish({ content: modeContent({ operation: '写长文' }), options: { operation: '写长文' } }),
            Bun.sleep(400).then(() => 'body-read-hung'),
        ]);
        expect(result).not.toBe('body-read-hung');
        expect((result as Result).ok).toBe(true);
        expect(fake.contextResponseHandlers.size).toBe(0);
    });

    test('AC3: offline checks read expiry without launching or spending the check budget', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-xhs-offline-'));
        const never: BrowserLauncher = {
            launch: async () => {
                throw new Error('offline must not launch');
            },
        };
        const events: string[] = [];
        const guard: AutomationGuard = {
            allow: () => {
                events.push('allow');
                return { allowed: false, reason: 'spent' };
            },
            record: () => {
                events.push('record');
            },
        };
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        try {
            for (const [name, expiresAt, expected] of [
                ['future', '2099-01-01T00:00:00.000Z', 'verified'],
                ['past', '2000-01-01T00:00:00.000Z', 'refused'],
                ['legacy', undefined, 'verified'],
                ['absent', undefined, 'refused'],
            ] as const) {
                const profileDir = join(dir, name);
                if (name !== 'absent') {
                    await mkdir(profileDir);
                    if (expiresAt)
                        await Bun.write(
                            join(profileDir, 'bot.json'),
                            JSON.stringify({
                                schemaVersion: 1,
                                authenticationEvidence: 'site-verified',
                                defaultUrl: 'https://creator.xiaohongshu.com/publish/publish',
                                expiresAt,
                            }),
                        );
                }
                const code = await profileCheckMain(['check', '--profile', profileDir], never, guard);
                const verdict = JSON.parse(out.text().trim().split('\n').at(-1) ?? '');
                expect(verdict.status).toBe(expected);
                expect(code).toBe(expected === 'verified' ? 0 : 1);
                if (expected === 'verified') expect(verdict.detail).toStartWith('offline:');
                expect(verdict.detail).toContain(expiresAt ?? (name === 'legacy' ? 'expiry unknown' : profileDir));
            }
            const corrupt = join(dir, 'corrupt');
            await mkdir(corrupt);
            await Bun.write(join(corrupt, 'bot.json'), 'bad json');
            expect(await profileCheckMain(['check', '--profile', corrupt], never, guard)).toBe(1);
            expect(out.text()).toContain('corrupt bot metadata');
            const unreadable = join(dir, 'unreadable');
            await mkdir(join(unreadable, 'bot.json'), { recursive: true });
            expect(await profileCheckMain(['check', '--profile', unreadable], never, guard)).toBe(1);
            expect(out.text()).toContain('cannot read bot metadata');
            const fileProfile = join(dir, 'regular-file');
            await Bun.write(fileProfile, 'not a profile directory');
            expect(await profileCheckMain(['check', '--profile', fileProfile], never, guard)).toBe(1);
            expect(out.text()).toContain('not a directory');
            expect(await profileCheckMain(['check', '--heade'], never, guard)).toBe(2);
            expect(events).toEqual([]);
        } finally {
            restore();
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('AC2: a dead console refuses inside the visit, closes it and spends the publish budget', async () => {
        await seedImages();
        const { open, closed, calls } = makeOpenPage({ ...happy, loggedIn: false });
        const records: string[] = [];
        const result = await makeTransport('script', {
            openPage: open,
            loginTimeoutMs: 20,
            automation: {
                allow: () => ({ allowed: true, reason: '' }),
                record: (event) => {
                    records.push(event);
                },
            },
        }).publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('session readiness refused');
        expect(result.error).toContain('kk bot login xhs');
        expect(result.metadata?.itcDelivery).toEqual({ schemaVersion: 1, effect: 'none' });
        expect(records).toEqual(['publish']);
        expect(calls).toHaveLength(1);
        expect(closed).toHaveLength(1);
        expect(calls[0]?.find((call) => call.op === 'goto')?.args).toHaveLength(1);
    });

    test('AC4: shared bot login reports the persistent cookie expiry', async () => {
        const out = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out });
        const requests: Array<{ profileDir: string; headless: boolean }> = [];
        const expiry = Math.floor(Date.parse('2099-01-01T00:00:00Z') / 1000);
        const context = {
            ...(consoleContext(true) as object),
            cookies: async () => [
                {
                    domain: '.xiaohongshu.com',
                    path: '/',
                    expires: expiry,
                    httpOnly: true,
                    secure: true,
                    name: 'session',
                    value: 'fake',
                },
            ],
        };
        try {
            expect(
                await profileCheckMain(
                    [
                        'login',
                        '--profile',
                        '/tmp/xhs-0370-login',
                        '--url',
                        'https://creator.xiaohongshu.com/publish/publish',
                    ],
                    fakeLauncher(context, requests),
                ),
            ).toBe(0);
            expect(JSON.parse(out.text().trim().split('\n').at(-1) ?? '')).toMatchObject({
                status: 'verified',
                defaultUrl: 'https://creator.xiaohongshu.com/publish/publish',
                expiresAt: '2099-01-01T00:00:00.000Z',
            });
            expect(requests.map((request) => request.headless)).toEqual([false]);
        } finally {
            restore();
        }
    });

    test('AC2: navigation refusal and stalled navigation are bounded effect-free session refusals', async () => {
        await seedImages();
        for (const goto of [
            async () => {
                throw new Error('navigation timed out');
            },
            async () => {
                await new Promise(() => {});
            },
        ]) {
            const fake = makeFakePage(happy);
            fake.page.goto = goto;
            let closed = 0;
            const result = await Promise.race([
                makeTransport('script', {
                    openPage: async () => ({
                        page: fake.page,
                        close: async () => {
                            closed += 1;
                        },
                    }),
                    loginTimeoutMs: 20,
                }).publish({ content: cardContent() }),
                Bun.sleep(300).then(() => 'readiness-hung'),
            ]);
            expect(result).not.toBe('readiness-hung');
            expect((result as Result).error).toContain('session readiness refused');
            expect((result as Result).error).toContain('kk bot login xhs');
            expect((result as Result).metadata?.itcDelivery).toEqual({ schemaVersion: 1, effect: 'none' });
            expect(fake.calls.some((entry) => entry.op === 'setInputFiles')).toBe(false);
            expect(closed).toBe(1);
        }
    });
});

describe('xhs-pub validation (no browser opens)', () => {
    test('default driver is script, kind browser', () => {
        const t = makeTransport();
        expect(t.kind).toBe('browser');
        expect(t.driver).toBe('script');
    });

    test('agent driver fails loud before any browser action', async () => {
        const { open, closed } = makeOpenPage(happy);
        const result = await makeTransport('agent', { openPage: open }).publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('unsupported driver');
        expect(closed).toHaveLength(0);
    });

    test('unknown publishStatus rejected', async () => {
        const r = await validatePublishInput(cardContent({ publishStatus: 'friends' }));
        expect(r.error).toContain('publishStatus');
    });

    test('empty images rejected', async () => {
        const r = await validatePublishInput(cardContent({ images: [] }));
        expect(r.error).toContain('non-empty');
    });

    test('relative path rejected', async () => {
        await seedImages();
        const c = cardContent({ images: [{ path: 'cards/card-0.png' }] });
        const r = await validatePublishInput(c);
        expect(r.error).toContain('absolute');
    });

    test('unsupported extension rejected', async () => {
        await seedImages();
        const c = cardContent({ images: [{ path: join(tmpRoot, 'card-0.gif') }] });
        const r = await validatePublishInput(c);
        expect(r.error).toContain('unsupported extension');
    });

    test('missing file rejected', async () => {
        const c = cardContent({ images: [{ path: join(tmpRoot, 'nope.png') }] });
        const r = await validatePublishInput(c);
        expect(r.error).toContain('does not exist');
    });

    test('transport fails before openPage on invalid images', async () => {
        const { open, closed } = makeOpenPage(happy);
        const t = makeTransport('script', { openPage: open, stepTimeoutMs: 50, submitSettleMs: 10 });
        const result = await t.publish({ content: cardContent({ images: [] }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('non-empty');
        expect(closed).toHaveLength(0);
    });
});

describe('xhs-pub script flow (fake page)', () => {
    test('draft: ordered paths in one setInputFiles call, confirmed save, no id', async () => {
        await seedImages();
        const { open, closed } = makeOpenPage(happy);
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 500,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        expect(result.id).toBeUndefined();
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(result.metadata?.driver).toBe('script');
        expect(result.metadata?.imageCount).toBe(2);
        expect(result.message).toContain(PROFILE);
        // R4: the draft control was read out of the closed shadow bar, never guessed
        expect(result.metadata?.draftControl).toBe('暂存离开');
        expect(result.metadata?.draftCountBefore).toBe(0);
        expect(result.metadata?.draftCountAfter).toBe(1);
        expect(result.metadata?.draftAttempts).toBe(1);
        expect(result.metadata?.draftClick).toBe('606,855');
        expect(closed).toHaveLength(1);
    });

    test('regression 2026-11-10: a draft save never runs while a thumbnail still carries a blob src', async () => {
        await seedImages();
        // The original failure: previews render locally (blob) and the wire stays silent — the
        // console never uploaded, so the durability gate fails before any save.
        const state = { ...happy, thumbLocalSrcs: true, uploadNeverStarts: true };
        const { open, calls } = makeOpenPage(state);
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('durable previews');
        expect(result.error).toContain('local (blob/data) src');
        // No draft click may fire before every image has a durable server-side src.
        expect(state.draftClicked).toBe(false);
        expect(calls.some((pageCalls) => pageCalls.some((entry) => entry.op === 'findShadowControl'))).toBe(false);
    });

    test('regression 2026-11-10: the console settles before the tab click and the drop stays single', async () => {
        await seedImages();
        const { open, calls } = makeOpenPage({ ...happy });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        const ops = (calls[0] ?? []).map((entry) => entry.op);
        // The uploader mounts while the SPA idles: the settle subscribe precedes mode entry.
        expect(ops.indexOf('onContextResponse')).toBeGreaterThan(-1);
        expect(ops.indexOf('onContextResponse')).toBeLessThan(ops.indexOf('boundingBoxesOnScreen'));
        // One drop only — a re-drop duplicates the previews on the live console (14 previews).
        const drops = (calls[0] ?? []).filter((entry) => entry.op === 'setInputFiles');
        expect(drops).toHaveLength(1);
    });

    test("the bar's _onSave host method is the draft trigger; the click fallback stays intact without it", async () => {
        await seedImages();
        const { open } = makeOpenPage({ ...happy, hostSaveMethod: '_onSave' });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 500,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        expect(result.metadata?.draftControl).toBe('_onSave:_onSave');
        expect(result.metadata?.draftPath).toBe('shadow');
        expect(result.metadata?.draftClick).toBe('shadow-host-method');
    });

    test('live console contract: in-viewport tab click, hidden input upload, TipTap body, shadow draft', async () => {
        await seedImages();
        const state = { ...happy };
        const { open, calls } = makeOpenPage(state);
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 500,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        const log = calls[0] ?? [];
        const ops = log.map((entry) => entry.op);
        expect(ops[0]).toBe('goto');
        // R1: the console opens on the video tab, so the image tab is entered before any upload —
        // via a raw coordinate click at the live tab's centre (locator clicks land on clones).
        expect(ops.indexOf('boundingBoxesOnScreen')).toBeGreaterThan(ops.indexOf('goto'));
        expect(ops.indexOf('boundingBoxesOnScreen')).toBeLessThan(ops.indexOf('setInputFiles'));
        expect(ops).toContain('clickAt');
        // R2: the note body is the TipTap editor (Quill was replaced in 2026-09), and it must be
        // TYPED — a synthetic value set leaves nothing for the save to persist.
        const typed = log.filter((entry) => entry.op === 'type').map((entry) => String(entry.args[0]));
        expect(typed).toContain('div.tiptap[contenteditable="true"]');
        const filled = log.filter((entry) => entry.op === 'fill').map((entry) => String(entry.args[0]));
        expect(filled).not.toContain('div.tiptap[contenteditable="true"]');
        // R3: previews are counted through XHS's own `preivew` class, and the upload goes through
        // the visible `input[type="file"]` (the accept-scoped probes matched hidden clones).
        const selectors = log.filter((entry) => entry.op === 'locator').map((entry) => String(entry.args[0]));
        expect(selectors).toContain('img.preivew-image');
        // R4: the submit control is resolved by label inside the closed shadow bar.
        const shadow = log.find((entry) => entry.op === 'findShadowControl');
        expect(shadow?.args[0]).toEqual(['暂存离开', '存草稿', '保存草稿']);
        expect(ops).toContain('clickAt');
    });

    test('no CDP shadow access fails loud instead of clicking a guessed coordinate', async () => {
        await seedImages();
        const fake = makeFakePage({ ...happy });
        const pageWithoutShadow: XhsPage = {
            ...fake.page,
            findShadowControl: undefined,
        };
        const open: OpenPage = async () => ({ page: pageWithoutShadow, close: async () => {} });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('closed shadow root');
        expect(result.error).toContain('CDP');
    });

    test('closed shadow bar without the draft control fails loud naming the labels', async () => {
        await seedImages();
        const fake = makeFakePage({ ...happy, shadowBar: false });
        const open: OpenPage = async () => ({ page: fake.page, close: async () => {} });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('publish bar');
        expect(result.error).toContain('暂存离开');
    });

    test('no in-viewport image tab fails loud rather than clicking an off-screen duplicate', async () => {
        await seedImages();
        const fake = makeFakePage({ ...happy });
        const open: OpenPage = async () => ({
            page: { ...fake.page, boundingBoxesOnScreen: async () => [] },
            close: async () => {},
        });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("no on-screen '上传图文' tab");
        expect(result.error).toContain('the mode was not entered');
    });

    test('paths reach setInputFiles in payload order, single call', async () => {
        await seedImages(3);
        const state = { ...happy };
        const { open } = makeOpenPage(state);
        const captured: { uploaded: string[] | null; calls: number } = { uploaded: null, calls: 0 };
        const openSpy: OpenPage = async (profileDir) => {
            const inner = await open(profileDir);
            const wrapped: XhsPage = {
                ...inner.page,
                setInputFiles: async (selector, paths) => {
                    await inner.page.setInputFiles(selector, paths);
                    captured.calls += 1;
                    captured.uploaded = [...paths];
                },
            };
            return { page: wrapped, close: inner.close };
        };
        const t = makeTransport('script', {
            openPage: openSpy,
            stepTimeoutMs: 500,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent({}, 3) });
        expect(result.ok).toBe(true);
        expect(captured.calls).toBe(1);
        expect(captured.uploaded).toEqual([img(0), img(1), img(2)]);
    });

    test('public: explicit publishStatus publishes and reports observed url', async () => {
        await seedImages();
        const { open, closed } = makeOpenPage(happy);
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 500,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent({ publishStatus: 'public' }) });
        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.url).toBe('https://www.xiaohongshu.com/explore/abc123');
        expect(closed).toHaveLength(1);
    });

    test('login timeout fails loud with profile dir', async () => {
        await seedImages();
        const state = { ...happy, loggedIn: false };
        const { open, closed } = makeOpenPage(state);
        const t = makeTransport('script', { openPage: open, loginTimeoutMs: 40, stepTimeoutMs: 40 });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('session readiness refused');
        expect(result.error).toContain(PROFILE);
        expect(closed).toHaveLength(1);
    });

    test('thumbnail count mismatch fails naming the step', async () => {
        await seedImages();
        const state = { ...happy, uploadThumbCount: 1 };
        const { open, closed } = makeOpenPage(state);
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 60,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('thumbnail count');
        expect(result.error).toContain('expected 2');
        expect(closed).toHaveLength(1);
    });

    test('draft confirmation fails naming the step when the counter does not move', async () => {
        await seedImages();
        const state: FakeState = { ...happy, draftSaveIsSilent: true };
        const { open, closed } = makeOpenPage(state);
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
        expect(result.error).toContain('neither a fresh');
        expect(closed).toHaveLength(1);
    });

    test('draft confirmation can rest on the console save timestamp alone', async () => {
        await seedImages();
        const state: FakeState = { ...happy, counterUnreadable: true };
        const { open } = makeOpenPage(state);
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 300,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        // The counter is the editor-suppressed landing label: unreadable on this console.
        expect(result.metadata?.draftCountBefore).toBeNull();
        expect(result.metadata?.draftCountAfter).toBeNull();
    });

    test('ambiguous public submit warns about duplicate risk', async () => {
        await seedImages();
        const state: FakeState = { ...happy, publishConfirm: false };
        const { open, closed } = makeOpenPage(state);
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 60,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent({ publishStatus: 'public' }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('state unknown');
        expect(result.error).toContain('duplicate');
        expect(result.error).toContain('note manager');
        expect(closed).toHaveLength(1);
    });

    test('openPage failure (missing playwright) fails loud', async () => {
        await seedImages();
        const open: OpenPage = async () => {
            // Upstream wording (@gobing-ai/ts-browser-automation PlaywrightUnavailableError).
            throw new Error(
                'The "playwright" peer dependency is not installed. Add playwright@^1.55.0 to your dependencies and run `npx playwright install chromium` to download the browser.',
            );
        };
        const t = makeTransport('script', { openPage: open, stepTimeoutMs: 50, submitSettleMs: 10 });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('playwright');
    });
});

describe('xhs-pub playwright adapter', () => {
    test('wrapPlaywrightPage delegates to the raw page', async () => {
        const recorded: string[] = [];
        const stub = {
            goto: async (url: string) => {
                recorded.push(`goto:${url}`);
            },
            locator: (_selector: string) => ({
                count: async () => 2,
                nth: (index: number) => ({
                    boundingBox: async () =>
                        index === 0
                            ? { x: -60, y: 10, width: 80, height: 20 } // off-viewport duplicate
                            : { x: 12, y: 24, width: 80, height: 20 },
                    click: async (opts?: { force?: boolean }) => {
                        recorded.push(`nthClick:${index}:force=${String(opts?.force)}`);
                    },
                }),
                first: () => ({
                    count: async () => 7,
                    isVisible: async () => true,
                    fill: async (t: string) => {
                        recorded.push(`fill:${t}`);
                    },
                    click: async () => {
                        recorded.push('click');
                    },
                    pressSequentially: async (t: string) => {
                        recorded.push(`type:${t}`);
                    },
                    textContent: async () => '草稿箱(3)',
                }),
            }),
            setInputFiles: async (s: string, p: readonly string[]) => {
                recorded.push(`files:${s}:${p.join(',')}`);
            },
            waitForSelector: async (s: string) => s,
            url: () => 'https://example.com/done',
            viewportSize: () => ({ width: 1000, height: 800 }),
            mouse: {
                click: async (x: number, y: number) => {
                    recorded.push(`mouse:${x},${y}`);
                },
            },
        };
        const page = wrapPlaywrightPage(stub, {
            findControl: async (labels) => ({ label: labels[0] ?? '', x: 606, y: 855 }),
        });
        await page.goto('https://example.com');
        await page.setInputFiles('input', ['/a.png']);
        await page.locator('input').first().fill('hello');
        await page.locator('input').first().type?.('typed');
        await page.locator('input').first().click();
        expect(await page.locator('input').first().count()).toBe(7);
        expect(await page.locator('input').first().isVisible()).toBe(true);
        expect(await page.locator('input').first().textContent?.()).toBe('草稿箱(3)');
        expect(await page.waitForSelector('sel')).toBe('sel');
        expect(page.url()).toBe('https://example.com/done');
        // The in-viewport duplicate is the one clicked, and the tab click must be forced.
        expect(await page.clickInViewport?.('div.creator-tab')).toBe(true);
        expect(await page.findShadowControl?.(['暂存离开'])).toEqual({ label: '暂存离开', x: 606, y: 855 });
        await page.clickAt?.(606, 855);
        expect(recorded).toEqual([
            'goto:https://example.com',
            'files:input:/a.png',
            'fill:hello',
            'type:typed',
            'click',
            'nthClick:1:force=true',
            'mouse:606,855',
        ]);
    });

    // The 2026-11-10 durability seam: spectrum-upload tracking needs page- and context-level
    // response subscriptions, and the wrapped page must forward them to the raw Playwright page.
    test('wrapPlaywrightPage wires response tracking and geometry reads onto the raw page', async () => {
        const events: string[] = [];
        const handler = (payload: unknown): void => {
            void payload;
        };
        const stub = {
            on: (event: string, fn: (payload: unknown) => void) => {
                expect(fn).toBe(handler);
                events.push(`on:${event}`);
            },
            off: (event: string, fn: (payload: unknown) => void) => {
                expect(fn).toBe(handler);
                events.push(`off:${event}`);
            },
            context: () => ({
                on: (event: string, fn: (payload: unknown) => void) => {
                    expect(fn).toBe(handler);
                    events.push(`ctx-on:${event}`);
                },
                off: (event: string, fn: (payload: unknown) => void) => {
                    expect(fn).toBe(handler);
                    events.push(`ctx-off:${event}`);
                },
            }),
            locator: (_selector: string) => ({
                count: async () => 2,
                nth: (index: number) => ({
                    boundingBox: async () => (index === 0 ? null : { x: 5, y: 6, width: 7, height: 8 }),
                    click: async () => undefined,
                }),
            }),
            viewportSize: () => ({ width: 1000, height: 800 }),
        };
        const page = wrapPlaywrightPage(stub);
        page.on?.('request', handler);
        page.off?.('request', handler);
        page.onContextResponse?.(handler);
        page.offContextResponse?.(handler);
        expect(events).toEqual(['on:request', 'off:request', 'ctx-on:response', 'ctx-off:response']);
        // A seam without a raw event source degrades to a typed rejection, never a silent hang.
        await expect(page.waitForEvent?.('filechooser')).rejects.toThrow(
            "the page seam does not expose a 'filechooser' event source",
        );
        expect(await page.boundingBoxesOnScreen?.('div.creator-tab')).toEqual([{ x: 5, y: 6, width: 7, height: 8 }]);
    });

    // Tab entry must fail fast (not hang) when the driver cannot tell on-screen tabs apart.
    test('clickCreatorTab rejects a driver that cannot read viewport geometry', async () => {
        const bare = { countOnScreen: async () => 4 } as unknown as XhsPage;
        await expect(clickCreatorTab(bare, '视频')).rejects.toThrow('cannot read viewport geometry');
    });

    // 20261016: the 2026-10-16 daily run lost its XHS draft to a single `net::ERR_TIMED_OUT` on
    // the creator page, and the 10-13 preflight lost its probe to a `waiting until "load"` timeout.
    test('goto retries a transient connect fault once, and never waits on `load`', async () => {
        const calls: Array<{ url: string; options: Record<string, unknown> }> = [];
        const stub = {
            goto: async (url: string, options: Record<string, unknown>) => {
                calls.push({ url, options });
                if (calls.length === 1) {
                    throw new Error(
                        `page.goto: net::ERR_TIMED_OUT at ${url}\nCall log:\n  - navigating to "${url}", waiting until "load"`,
                    );
                }
            },
            url: () => 'https://creator.xiaohongshu.com/publish/publish',
        };
        await wrapPlaywrightPage(stub).goto('https://creator.xiaohongshu.com/publish/publish', {
            timeout: 120_000,
        });
        expect(calls).toHaveLength(2);
        expect(calls.map((call) => call.options)).toEqual([
            { waitUntil: 'domcontentloaded', timeout: 120_000 },
            { waitUntil: 'domcontentloaded', timeout: 120_000 },
        ]);
    });

    test('goto reports a non-transient navigation failure without retrying', async () => {
        let attempts = 0;
        const stub = {
            goto: async () => {
                attempts += 1;
                throw new Error('page.goto: net::ERR_CERT_DATE_INVALID at https://creator.xiaohongshu.com/');
            },
            url: () => 'about:blank',
        };
        await expect(wrapPlaywrightPage(stub).goto('https://creator.xiaohongshu.com/')).rejects.toThrow(
            'ERR_CERT_DATE_INVALID',
        );
        expect(attempts).toBe(1);
    });

    test('boundingBox resolves the innermost on-screen match when a :has-text selector matches outer modal ancestors', async () => {
        const boxes = [
            { x: 100, y: 100, width: 600, height: 400 }, // outer .d-modal wrapper div
            { x: 410, y: 149, width: 160, height: 160 }, // inner 设置封面 card div
        ];
        const stub = {
            goto: async () => {},
            locator: () => ({
                count: async () => boxes.length,
                nth: (index: number) => ({
                    boundingBox: async () => boxes[index] ?? null,
                    click: async () => {},
                }),
                first: () => ({
                    count: async () => boxes.length,
                    isVisible: async () => true,
                    fill: async () => {},
                    click: async () => {},
                    boundingBox: async () => boxes[0] ?? null,
                }),
            }),
            setInputFiles: async () => {},
            waitForSelector: async () => null,
            url: () => 'https://creator.xiaohongshu.com/publish/publish',
            viewportSize: () => ({ width: 1280, height: 800 }),
            mouse: { click: async () => {} },
        };
        const page = wrapPlaywrightPage(stub);
        expect(await page.locator('.d-modal div:has-text("设置封面")').first().boundingBox()).toEqual({
            x: 410,
            y: 149,
            width: 160,
            height: 160,
        });
    });
});

/** Canned CDP session for the closed-shadow probe (no browser needed). */
function fakeCdp(tree: unknown, box?: { content: number[] }) {
    const calls: string[] = [];
    const session = {
        send: async (method: string, _params?: Record<string, unknown>) => {
            calls.push(method);
            if (method === 'DOM.getDocument') return { root: tree };
            if (method === 'DOM.getBoxModel') return box ? { model: box } : {};
            return {};
        },
    };
    return { session, calls };
}

const shadowButton = (label: string, id = 42) => ({
    nodeName: 'BUTTON',
    backendNodeId: id,
    children: [{ nodeName: '#text', nodeValue: label }],
});

const boxAt = (x1: number, y1: number, x3: number, y4: number) => ({
    content: [x1, y1, x3, y1, x3, y4, x1, y4],
});

describe('xhs-pub closed-shadow CDP probe (task 0174 R4)', () => {
    test('resolves a labelled control inside a closed shadow root to its centre', async () => {
        const tree = {
            nodeName: '#document',
            children: [
                {
                    nodeName: 'DIV',
                    children: [],
                    shadowRoots: [{ nodeName: '#document-fragment', children: [shadowButton('暂存离开')] }],
                },
            ],
        };
        const { session, calls } = fakeCdp(tree, boxAt(0, 0, 100, 40));
        const probe = await createShadowProbe({ newCDPSession: async () => session }, {});
        expect(probe).toBeDefined();
        expect(await probe?.findControl(['暂存离开'])).toEqual({ label: '暂存离开', x: 50, y: 20 });
        expect(calls).toContain('DOM.enable');
        expect(calls).toContain('DOM.getBoxModel');
    });

    test('finds a control nested in a shadow root inside a shadow root', async () => {
        const tree = {
            nodeName: '#document',
            children: [
                {
                    nodeName: 'DIV',
                    shadowRoots: [
                        {
                            nodeName: '#document-fragment',
                            children: [
                                {
                                    nodeName: 'SPAN',
                                    shadowRoots: [
                                        { nodeName: '#document-fragment', children: [shadowButton('发布', 7)] },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const { session } = fakeCdp(tree, boxAt(10, 10, 30, 50));
        const probe = await createShadowProbe({ newCDPSession: async () => session }, {});
        expect(await probe?.findControl(['暂存离开', '发布'])).toEqual({ label: '发布', x: 20, y: 30 });
    });

    test('ignores non-button labels, missing matches and unusable geometry', async () => {
        const labelled = {
            nodeName: 'DIV',
            backendNodeId: 9,
            children: [{ nodeName: '#text', nodeValue: '暂存离开' }],
        };
        const tree = { nodeName: '#document', children: [labelled] };
        const noMatch = await createShadowProbe({ newCDPSession: async () => fakeCdp(tree).session }, {});
        // A div that merely carries the text is not the control.
        expect(await noMatch?.findControl(['暂存离开'])).toBeNull();

        const buttonTree = { nodeName: '#document', children: [shadowButton('暂存离开')] };
        const shortBox = await createShadowProbe(
            { newCDPSession: async () => fakeCdp(buttonTree, { content: [1, 2] }).session },
            {},
        );
        expect(await shortBox?.findControl(['暂存离开'])).toBeNull();

        const noBox = await createShadowProbe({ newCDPSession: async () => fakeCdp(buttonTree).session }, {});
        expect(await noBox?.findControl(['暂存离开'])).toBeNull();
    });

    test('returns undefined when CDP is unavailable, fails, or has no root', async () => {
        expect(await createShadowProbe({}, {})).toBeUndefined();
        const throwing = await createShadowProbe(
            {
                newCDPSession: async () => {
                    throw new Error('CDP unavailable');
                },
            },
            {},
        );
        expect(throwing).toBeUndefined();
        const rootless = await createShadowProbe({ newCDPSession: async () => fakeCdp(undefined).session }, {});
        expect(await rootless?.findControl(['暂存离开'])).toBeNull();
    });

    test('without a shadow probe the seam reports no shadow control', async () => {
        const stub = {
            goto: async () => {},
            locator: () => ({
                count: async () => 0,
                nth: () => ({ boundingBox: async () => null, click: async () => {} }),
                first: () => ({
                    count: async () => 0,
                    isVisible: async () => false,
                    fill: async () => {},
                    click: async () => {},
                }),
            }),
            setInputFiles: async () => {},
            waitForSelector: async () => null,
            url: () => 'about:blank',
            mouse: { click: async () => {} },
        };
        const page = wrapPlaywrightPage(stub);
        expect(await page.findShadowControl?.(['暂存离开'])).toBeNull();
        // No viewport and no candidate boxes: nothing is clickable, so the tab step fails loud.
        expect(await page.clickInViewport?.('div.creator-tab')).toBe(false);
    });

    // defaultOpenPage is intentionally not unit-tested: with playwright resolvable it
    // launches a real headed Chromium against the profile dir; without it the install-hint
    // throw path is trivial. It is exercised end-to-end by manual dogfood (task 0167 AC).
});

describe('xhs-pub CLI surface (unchanged contract)', () => {
    test('FakeBrowserTransport offline processPublishIO', async () => {
        const fake = new FakeBrowserTransport('script');
        await mkdir(tmpRoot, { recursive: true });
        const inPath = join(tmpRoot, 'in.json');
        const outPath = join(tmpRoot, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'Parity', body: 'Body.', format: 'markdown' }));
        try {
            await processPublishIO(inPath, outPath, fake);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            await rm(tmpRoot, { recursive: true, force: true });
        }
    });

    test('getPublishTransport fake switch', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeBrowserTransport);
            expect(getPublishTransport('script').kind).toBe('browser');
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('main returns 1 without --in/--out and 0 on fake transport', async () => {
        const origArgv = process.argv;
        // An in-process CLI call must not decide the test runner's exit code: `main()` and its
        // error path write to `process.exitCode`, which would fail the suite with 0 test failures.
        const origExitCode = process.exitCode;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');
        } finally {
            restore();
            process.argv = origArgv;
            process.exitCode = origExitCode;
        }

        await mkdir(tmpRoot, { recursive: true });
        const inPath = join(tmpRoot, 'in.json');
        const outPath = join(tmpRoot, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.argv = origArgv;
            process.exitCode = origExitCode;
            await rm(tmpRoot, { recursive: true, force: true });
        }
    });

    test('invocable via runInvoke', async () => {
        const origExitCode = process.exitCode;
        await mkdir(tmpRoot, { recursive: true });
        const inPath = join(tmpRoot, 'in.json');
        const outPath = join(tmpRoot, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(
                await runInvoke({
                    plugin: 'xhs-pub',
                    inPath,
                    outPath,
                    pluginsRoot: join(process.cwd(), 'plugins'),
                }),
            ).toBe(0);
        } finally {
            process.exitCode = origExitCode;
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpRoot, { recursive: true, force: true });
        }
    });
});

describe('xhs-pub default page opener (task 0174 wiring)', () => {
    const rawPage = () => ({
        goto: async () => {},
        locator: () => ({
            count: async () => 0,
            nth: () => ({ boundingBox: async () => null, click: async () => {} }),
            first: () => ({
                count: async () => 0,
                isVisible: async () => false,
                fill: async () => {},
                click: async () => {},
                textContent: async () => '',
            }),
        }),
        setInputFiles: async () => {},
        waitForSelector: async () => null,
        url: () => 'https://creator.xiaohongshu.com/publish/publish',
        viewportSize: () => ({ width: 1000, height: 800 }),
        mouse: { click: async () => {} },
    });

    test('wraps the existing page, wires the CDP probe, and closes the context', async () => {
        const closed: string[] = [];
        const launched: Array<{ profileDir: string; headless: boolean }> = [];
        const { session } = fakeCdp(
            // The production shape: the label lives inside a CLOSED shadow root hanging off a
            // light-DOM host, which is exactly what no locator can reach.
            {
                nodeName: '#document',
                children: [
                    {
                        nodeName: 'DIV',
                        children: [],
                        shadowRoots: [{ nodeName: '#document-fragment', children: [shadowButton('暂存离开')] }],
                    },
                ],
            },
            boxAt(0, 0, 40, 20),
        );
        const open = makeDefaultOpenPage(async (options) => {
            launched.push(options);
            return {
                pages: () => [rawPage()],
                newPage: async () => rawPage(),
                close: async () => void closed.push('closed'),
                newCDPSession: async () => session,
            };
        });
        const opened = await open('/tmp/profile');
        expect(launched).toEqual([{ profileDir: '/tmp/profile', headless: false }]);
        expect(opened.page.url()).toContain('creator.xiaohongshu.com');
        expect(await opened.page.findShadowControl?.(['暂存离开'])).toEqual({ label: '暂存离开', x: 20, y: 10 });
        await opened.close();
        expect(closed).toEqual(['closed']);
    });

    test('closes the launched context when creating its page fails (0177)', async () => {
        let closed = 0;
        const open = makeDefaultOpenPage(async () => ({
            pages: () => [],
            newPage: async () => {
                throw new Error('page creation failed');
            },
            close: async () => void closed++,
        }));
        await expect(open('/tmp/profile')).rejects.toThrow('page creation failed');
        expect(closed).toBe(1);
    });

    test('opens a page when the context has none, and names the install hint on launch failure', async () => {
        let created = 0;
        const open = makeDefaultOpenPage(async () => ({
            pages: () => [],
            newPage: async () => {
                created += 1;
                return rawPage();
            },
            close: async () => {},
        }));
        const opened = await open('/tmp/profile');
        expect(created).toBe(1);
        expect(opened.page.url()).toContain('creator.xiaohongshu.com');

        const failing = makeDefaultOpenPage(async () => {
            throw new Error('playwright missing');
        });
        await expect(failing('/tmp/profile')).rejects.toThrow(/browser launch: playwright missing/);
        await expect(failing('/tmp/profile')).rejects.toThrow(/playwright install chromium/);
    });
});

describe('xhs-pub seam without a typing capability (task 0174 R2)', () => {
    test('a seam that cannot type cannot confirm a draft, so it fails loud', async () => {
        await seedImages();
        const state = { ...happy };
        const fake = makeFakePage(state);
        const filled: string[] = [];
        const page: XhsPage = {
            ...fake.page,
            locator: (selector) => {
                const inner = fake.page.locator(selector);
                const first = inner.first();
                return {
                    count: inner.count,
                    first: () => ({
                        count: first.count,
                        isVisible: first.isVisible,
                        click: first.click,
                        boundingBox: first.boundingBox,
                        fill: async (text) => {
                            if (selector.includes('tiptap')) filled.push(String(text));
                            await first.fill?.(text);
                        },
                        // No `type`: the driver must fall back to fill, and TipTap will not
                        // register it — the save stays unobservable.
                        textContent: first.textContent,
                    }),
                };
            },
        };
        const open: OpenPage = async () => ({ page, close: async () => {} });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(filled).toEqual(['正文']);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
    });
});

describe('xhs-pub resilient probes (task 0174)', () => {
    test('clickInViewport skips a candidate whose box cannot be read and clicks the next one', async () => {
        const clicks: number[] = [];
        const stub = {
            goto: async () => {},
            locator: () => ({
                count: async () => 2,
                nth: (index: number) => ({
                    boundingBox: async () => {
                        if (index === 0) throw new Error('element detached');
                        return { x: 5, y: 6, width: 10, height: 10 };
                    },
                    click: async () => void clicks.push(index),
                }),
                first: () => ({
                    count: async () => 0,
                    isVisible: async () => false,
                    fill: async () => {},
                    click: async () => {},
                }),
            }),
            setInputFiles: async () => {},
            waitForSelector: async () => null,
            url: () => 'about:blank',
            viewportSize: () => ({ width: 100, height: 100 }),
            mouse: { click: async () => {} },
        };
        const page = wrapPlaywrightPage(stub);
        expect(await page.clickInViewport?.('div.creator-tab')).toBe(true);
        expect(clicks).toEqual([1]);
    });

    test('unreadable draft signals cannot confirm a save', async () => {
        await seedImages();
        const state = { ...happy };
        const fake = makeFakePage(state);
        const page: XhsPage = {
            ...fake.page,
            locator: (selector) => {
                if (selector.includes('草稿箱') || selector.startsWith('text=保存于')) {
                    // The save-label queries fail mid-flight (detached node).
                    return {
                        count: async () => {
                            throw new Error('element detached');
                        },
                        first: (): XhsLocator => ({
                            boundingBox: async () => {
                                throw new Error('element detached');
                            },
                            count: async () => {
                                throw new Error('element detached');
                            },
                            isVisible: async () => {
                                throw new Error('element detached');
                            },
                            fill: async () => {
                                throw new Error('element detached');
                            },
                            click: async () => {
                                throw new Error('element detached');
                            },
                        }),
                    };
                }
                return fake.page.locator(selector);
            },
        };
        const open: OpenPage = async () => ({ page, close: async () => {} });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
        expect(result.error).toContain('before=null');
    });
});

describe('xhs-pub draft confirmation needs a delta from the pre-entry baseline (0174 review P2)', () => {
    test('a detached draft counter and timestamps are not recorded as save evidence', async () => {
        const { page } = makeFakePage({ ...happy });
        const baseline = await readDraftBaseline({
            ...page,
            locator: (selector) => {
                const locator = page.locator(selector);
                return {
                    ...locator,
                    count: async () => {
                        if (selector.startsWith('text=/草稿箱') || selector.startsWith('text=保存于')) {
                            throw new Error('draft locator detached');
                        }
                        return 1;
                    },
                    first: () => ({
                        ...locator.first(),
                        textContent: async () => {
                            throw new Error('draft counter detached');
                        },
                    }),
                };
            },
        });
        expect(baseline).toEqual({ count: null, stamps: [] });
    });

    const publishDraft = async (state: FakeState, open: OpenPage = makeOpenPage(state).open) => {
        await seedImages();
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        return t.publish({ content: cardContent() });
    };

    test('a counter-only save (no save timestamp) confirms from the counter delta', async () => {
        // Mirrors the live run: the console's counter moves and no stamp is printed.
        const result = await publishDraft({ ...happy, draftCount: 17, draftSaveStampsNothing: true });
        expect(result.ok).toBe(true);
        expect(result.metadata?.draftControl).toBe('暂存离开');
        expect(result.metadata?.draftCountBefore).toBe(17);
        expect(result.metadata?.draftCountAfter).toBe(18);
    });

    test('a counter-only save with an unmoved counter does not confirm', async () => {
        const result = await publishDraft({
            ...happy,
            draftCount: 17,
            draftSaveStampsNothing: true,
            draftSaveIsSilent: true,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
        expect(result.error).toContain('before=17');
    });

    test('a counter that only appears after the click cannot confirm a save', async () => {
        // No baseline (the counter was unreadable on entry), readable but unmoved after the save.
        const result = await publishDraft({
            ...happy,
            draftCount: 17,
            draftSaveStampsNothing: true,
            draftSaveIsSilent: true,
            counterHiddenAtBaseline: true,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
        expect(result.error).toContain('before=null');
    });

    test('a pre-existing save timestamp cannot confirm a save across a minute boundary', async () => {
        jest.useRealTimers();
        setSystemTime(new Date(2026, 8, 27, 12, 34, 50));
        // Calendar time is scripted; polling deadlines must still advance with real timers.
        const clock = spyOn(Date, 'now').mockImplementation(() => performance.now());
        try {
            const state = { ...happy, draftSaveIsSilent: true, draftSavedStamp: true };
            const { page } = makeFakePage(state);
            page.clickInViewport = async () => {
                setSystemTime(new Date(2026, 8, 27, 12, 35));
                return true;
            };
            const result = await publishDraft(state, async () => ({ page, close: async () => {} }));
            expect(result.ok).toBe(false);
            expect(result.error).toContain('draft confirmation');
        } finally {
            clock.mockRestore();
            setSystemTime();
        }
    });
});

describe('xhs-pub in-viewport tab selection requires a viewport (0174 review P4)', () => {
    test('does not click a candidate when the viewport cannot be read', async () => {
        const clicks: number[] = [];
        const stub = {
            goto: async () => {},
            locator: () => ({
                count: async () => 1,
                nth: (index: number) => ({
                    boundingBox: async () => ({ x: 10, y: 10, width: 40, height: 20 }),
                    click: async () => void clicks.push(index),
                }),
                first: () => ({
                    count: async () => 0,
                    isVisible: async () => false,
                    fill: async () => {},
                    click: async () => {},
                }),
            }),
            setInputFiles: async () => {},
            waitForSelector: async () => null,
            url: () => 'about:blank',
            // No viewportSize: the duplicate tabs cannot be told apart, so the step must fail loud.
            mouse: { click: async () => {} },
        };
        const page = wrapPlaywrightPage(stub);
        expect(await page.clickInViewport?.('div.creator-tab')).toBe(false);
        expect(clicks).toEqual([]);
    });
});

describe('xhs-pub live publish confirmation (0174 R5, measured 2026-09-26)', () => {
    const publishPublic = async (state: FakeState) => {
        await seedImages();
        const { open, calls } = makeOpenPage(state);
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 300,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent({ publishStatus: 'public' }) });
        return { result, log: calls[0] ?? [] };
    };

    test('confirms a published post from the console URL marker alone', async () => {
        // The live console rewrites its URL to `…published=true`; no light-DOM text appears.
        const { result } = await publishPublic({ ...happy, publishConfirm: false, publishUrlMarker: true });
        expect(result.ok).toBe(true);
        expect(result.url).toContain('published=true');
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.metadata?.publishControl).toBe('发布');
        expect(result.metadata?.publishSignal).toBe('url:published=true');
    });

    test('an unobserved publish fails loud and is never retried', async () => {
        const { result, log } = await publishPublic({ ...happy, publishConfirm: false, publishUrlMarker: false });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('state unknown');
        expect(result.error).toContain('duplicate');
        // Exactly one submit click: a retry could publish twice (the image tab click also lands
        // on clickAt now, so the count is tab + submit).
        expect(log.filter((entry) => entry.op === 'clickAt')).toHaveLength(2);
    });
});

describe('xhs-pub profile precedence (preserved, 0177)', () => {
    const opened: string[] = [];
    const probe: OpenPage = async (profileDir) => {
        opened.push(profileDir);
        throw new Error('probe-stop');
    };

    test('options.profileDir wins over both env overrides', async () => {
        await seedImages();
        process.env.XHS_PROFILE_DIR = '/tmp/kk-xhs-env';
        process.env.KK_BROWSER_PROFILE_DIR = '/tmp/kk-shared-env';
        try {
            const result = await makeTransport('script', { openPage: probe }).publish({
                content: cardContent(),
                options: { profileDir: '/tmp/kk-xhs-opt' },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toBe('probe-stop');
            expect(opened.at(-1)).toBe('/tmp/kk-xhs-opt');
        } finally {
            delete process.env.XHS_PROFILE_DIR;
            delete process.env.KK_BROWSER_PROFILE_DIR;
        }
    });

    test('XHS_PROFILE_DIR wins over KK_BROWSER_PROFILE_DIR', async () => {
        await seedImages();
        process.env.XHS_PROFILE_DIR = '/tmp/kk-xhs-env';
        process.env.KK_BROWSER_PROFILE_DIR = '/tmp/kk-shared-env';
        try {
            const result = await makeTransport('script', { openPage: probe }).publish({
                content: cardContent(),
            });
            expect(result.ok).toBe(false);
            expect(opened.at(-1)).toBe(resolve('/tmp/kk-xhs-env'));
        } finally {
            delete process.env.XHS_PROFILE_DIR;
            delete process.env.KK_BROWSER_PROFILE_DIR;
        }
    });

    test('KK_BROWSER_PROFILE_DIR is the first fallback', async () => {
        await seedImages();
        process.env.KK_BROWSER_PROFILE_DIR = '/tmp/kk-shared-env';
        try {
            const result = await makeTransport('script', { openPage: probe }).publish({
                content: cardContent(),
            });
            expect(result.ok).toBe(false);
            expect(opened.at(-1)).toBe(resolve('/tmp/kk-shared-env'));
        } finally {
            delete process.env.KK_BROWSER_PROFILE_DIR;
        }
    });

    test('default is the xhs channel profile dir', async () => {
        await seedImages();
        const result = await makeTransport('script', { openPage: probe }).publish({
            content: cardContent(),
        });
        expect(result.ok).toBe(false);
        expect(opened.at(-1)).toBe(PROFILE);
    });
});

describe('xhs-pub default launcher routes through the harness kk launcher (0177, 0214)', () => {
    test('the production default launcher is kkBrowserLauncher.launch, called headed', async () => {
        // Structural proof of AC1, offline: the production seam binds the upstream typed API.
        // (mock.module('playwright') does not intercept the published package's dynamic import,
        // so a behavioral test here would risk a real browser launch — never do that.)
        expect(defaultLauncher).toBe(kkBrowserLauncher.launch);

        const launched: Array<{ profileDir: string; headless: boolean }> = [];
        const closed: string[] = [];
        const open = makeDefaultOpenPage(async (options) => {
            launched.push(options);
            return { pages: () => [], newPage: async () => ({}), close: async () => void closed.push('closed') };
        });
        const opened = await open('/tmp/profile-0177');
        expect(launched).toEqual([{ profileDir: '/tmp/profile-0177', headless: false }]);
        await opened.close();
        expect(closed).toEqual(['closed']);
    });
});

/** Fake upstream BrowserLauncher: records launch requests, returns a scripted context. */
function fakeLauncher(
    context: unknown,
    requests: Array<{ profileDir: string; headless: boolean }> = [],
): BrowserLauncher {
    return {
        launch: async (request) => {
            requests.push({ ...request });
            return context as never;
        },
    };
}

/** Scripted creator-console context: `authenticated` drives the image-tab readiness gate. */
function consoleContext(authenticated: boolean, closed: string[] = []): unknown {
    return {
        pages: () => [],
        newPage: async () => ({
            goto: async () => {},
            locator: () => ({
                first: () => ({
                    count: async () => (authenticated ? 1 : 0),
                    isVisible: async () => authenticated,
                }),
            }),
            url: () => 'https://creator.xiaohongshu.com/publish/publish',
        }),
        close: async () => void closed.push('closed'),
    };
}

describe('xhs-pub headed profile-session check (0177, read-only)', () => {
    test('verified: reopens the profile headed once, read-only, and closes the context', async () => {
        const closed: string[] = [];
        const requests: Array<{ profileDir: string; headless: boolean }> = [];
        const launcher = fakeLauncher(consoleContext(true, closed), requests);
        const outcome = await checkProfileSession({ profileDir: '/tmp/kk-xhs-check', timeoutMs: 500, launcher });
        expect(outcome.status).toBe('verified');
        expect(outcome.detail).toContain('authenticated');
        expect(requests).toEqual([{ profileDir: '/tmp/kk-xhs-check', headless: false }]);
        expect(closed).toEqual(['closed']);
    });

    test('refused: the single headed readiness refusal is an explicit failure', async () => {
        const closed: string[] = [];
        const launcher = fakeLauncher(consoleContext(false, closed));
        const outcome = await checkProfileSession({ profileDir: '/tmp/kk-xhs-check', timeoutMs: 60, launcher });
        expect(outcome.status).toBe('refused');
        expect(outcome.detail).toContain('readiness refused');
        expect(closed).toEqual(['closed']);
    });

    test('refused: the headed check reports a missing-profile launch refusal', async () => {
        const launcher: BrowserLauncher = {
            launch: async () => {
                throw new BrowserProfileMissingError('/tmp/kk-xhs-absent');
            },
        };
        const outcome = await checkProfileSession({ profileDir: '/tmp/kk-xhs-absent', timeoutMs: 60, launcher });
        expect(outcome.status).toBe('refused');
        expect(outcome.detail).toContain('/tmp/kk-xhs-absent');
    });

    test('shared login: headed recovery resolves once authenticated and closes the context', async () => {
        const closed: string[] = [];
        const requests: Array<{ profileDir: string; headless: boolean }> = [];
        const launcher = fakeLauncher(consoleContext(true, closed), requests);
        expect(await profileCheckMain(['login', '--profile', '/tmp/kk-xhs-login', '--timeout', '500'], launcher)).toBe(
            0,
        );
        expect(requests).toEqual([{ profileDir: '/tmp/kk-xhs-login', headless: false }]);
        expect(closed).toEqual(['closed']);
    });

    test('shared login: expired session times out with the context closed', async () => {
        const closed: string[] = [];
        const launcher = fakeLauncher(consoleContext(false, closed));
        expect(await profileCheckMain(['login', '--profile', '/tmp/kk-xhs-login', '--timeout', '60'], launcher)).toBe(
            1,
        );
        expect(closed).toEqual(['closed']);
    });
});

describe('xhs-pub profile-check CLI (0177)', () => {
    test('check: exit 0 and a JSON verdict on stdout when the session is verified', async () => {
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        try {
            const code = await profileCheckMain(
                ['check', '--headed', '--profile', '/tmp/kk-xhs-check', '--timeout', '50'],
                fakeLauncher(consoleContext(true)),
            );
            expect(code).toBe(0);
            const verdict = JSON.parse(out.text()) as { status: string; profileDir: string; detail: string };
            expect(verdict.status).toBe('verified');
            expect(verdict.profileDir).toBe(resolve('/tmp/kk-xhs-check'));
        } finally {
            restore();
        }
    });

    test('check: exit 1 naming the refusal when the session is not verified', async () => {
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        try {
            const code = await profileCheckMain(
                ['check', '--headed', '--profile', '/tmp/kk-xhs-check', '--timeout', '50'],
                fakeLauncher(consoleContext(false)),
            );
            expect(code).toBe(1);
            expect(err.text()).toContain('readiness refused');
        } finally {
            restore();
        }
    });

    test('login: exit 0 when the headed login is confirmed', async () => {
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        try {
            const code = await profileCheckMain(
                ['login', '--profile', '/tmp/kk-xhs-login', '--timeout', '50'],
                fakeLauncher(consoleContext(true)),
            );
            expect(code).toBe(0);
            expect(out.text()).toContain('login verified');
        } finally {
            restore();
        }
    });

    test('login in bot mode emits the canonical defaultUrl verdict as the LAST stdout line (0277 R3)', async () => {
        // `kk bot login` persists a default URL ONLY from this line; without it a completed console
        // sign-in is discarded ("exited 0 but returned no usable defaultUrl verdict").
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        try {
            const profileDir = '/tmp/kk-xhs-login-bot';
            const code = await profileCheckMain(
                ['login', '--profile', profileDir, '--url', 'https://creator.xiaohongshu.com/publish/publish?op=1'],
                fakeLauncher(consoleContext(true)),
            );
            expect(code).toBe(0);
            const lines = out.text().trim().split('\n');
            expect(JSON.parse(lines[lines.length - 1] ?? '')).toEqual({
                status: 'verified',
                profileDir: resolve(profileDir),
                defaultUrl: 'https://creator.xiaohongshu.com/publish/publish',
            });
            // The operator's URL — with its query — must never become the persisted default.
            expect(out.text()).not.toContain('op=1');
        } finally {
            restore();
        }
    });

    test('login without --url keeps the operator-mode output (no verdict line, 0277 R3)', async () => {
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        try {
            const code = await profileCheckMain(
                ['login', '--profile', '/tmp/kk-xhs-login-op', '--timeout', '50'],
                fakeLauncher(consoleContext(true)),
            );
            expect(code).toBe(0);
            expect(out.text()).toContain('login verified');
            expect(out.text()).not.toContain('defaultUrl');
        } finally {
            restore();
        }
    });

    test('login: exit 1 on timeout', async () => {
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        try {
            const code = await profileCheckMain(
                ['login', '--profile', '/tmp/kk-xhs-login', '--timeout', '50'],
                fakeLauncher(consoleContext(false)),
            );
            expect(code).toBe(1);
            expect(err.text()).toContain('login failed');
        } finally {
            restore();
        }
    });

    test('unknown command and invalid --timeout fail with usage (exit 2, 0216 contract)', async () => {
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        try {
            expect(await profileCheckMain(['nonsense'], fakeLauncher(consoleContext(true)))).toBe(2);
            expect(err.text()).toContain('usage');
            expect(JSON.parse(out.text().trim().split('\n').at(-1) ?? '')).toEqual({
                status: 'error',
                detail: "unknown command 'nonsense'",
            });
            expect(await profileCheckMain(['check', '--timeout', 'later'])).toBe(2);
            expect(err.text()).toContain('--timeout');
        } finally {
            restore();
        }
    });

    test('check --headed (0216): probes headed only, never headless', async () => {
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        const requests: Array<{ profileDir: string; headless: boolean }> = [];
        try {
            const code = await profileCheckMain(
                ['check', '--headed', '--profile', '/tmp/kk-xhs-headed', '--timeout', '50'],
                fakeLauncher(consoleContext(false), requests),
            );
            expect(code).toBe(1);
            expect(requests.map((request) => request.headless)).toEqual([false]);
            const verdict = JSON.parse(out.text()) as { status: string };
            expect(verdict.status).toBe('refused');
        } finally {
            restore();
        }
    });

    test('check under a spent 2h budget refuses with a JSON verdict line, never a browser (0216 contract)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-xhs-budget-'));
        const statePath = join(dir, 'state.json');
        try {
            await writeFile(statePath, JSON.stringify({ check: '2026-09-28T09:30:00Z' }));
            const guard = createAutomationGuard({ statePath, now: () => new Date('2026-09-28T10:00:00Z') });
            const spentLauncher: BrowserLauncher = {
                launch: async () => {
                    throw new Error('no browser may open under a spent budget');
                },
            };
            const out = createBufferTarget();
            const restore = setDefaultOutputTargets({ stdout: out });
            try {
                const code = await profileCheckMain(
                    ['check', '--headed', '--profile', '/tmp/kk-xhs-budget'],
                    spentLauncher,
                    guard,
                );
                expect(code).toBe(1);
                const verdict = JSON.parse(out.text()) as { status: string; detail: string };
                expect(verdict.status).toBe('refused');
                expect(verdict.detail).toContain("'check' already ran");
            } finally {
                restore();
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('xhs-pub automation guard (ADR-025, XHS platform warning 2026-09-28)', () => {
    const NOW = () => new Date('2026-09-28T10:00:00Z');
    async function withGuardDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
        const dir = mkdtempSync(join(tmpdir(), 'kk-xhs-guard-'));
        try {
            return await fn(dir);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }

    test('cap: a second publish inside the window is refused before any browser opens', async () => {
        await seedImages();
        await withGuardDir(async (dir) => {
            const guard = createAutomationGuard({ statePath: join(dir, 'state.json'), now: NOW });
            // A successful headed launch that refuses readiness consumes the visit budget. A
            // browser-launch failure itself does not consume it because no console was visited.
            const { open } = makeOpenPage({ ...happy, loggedIn: false });
            const never = async () => {
                throw new Error('openPage must not be reached');
            };
            const first = makeTransport('script', { automation: guard, openPage: open, loginTimeoutMs: 20 });
            const firstResult = await first.publish({ content: cardContent() });
            expect(firstResult.ok).toBe(false);

            const second = makeTransport('script', { automation: guard, openPage: never });
            const secondResult = await second.publish({ content: cardContent() });
            expect(secondResult.ok).toBe(false);
            expect(secondResult.error).toContain('automation cap');
            expect(secondResult.error).toContain("'publish' already ran");
            // A pre-browser refusal must never read as an unknown-effect send: the 2026-11-12 daily
            // window lost 上传图文 this way and `--retry` refused it forever.
            expect(secondResult.metadata?.itcDelivery).toEqual({ schemaVersion: 1, effect: 'none' });
        });
    });

    test('readiness: a refused session consumes the single headed visit and closes it', async () => {
        await seedImages();
        await withGuardDir(async (dir) => {
            const guard = createAutomationGuard({ statePath: join(dir, 'state.json'), now: NOW });
            const { open, closed } = makeOpenPage({ ...happy, loggedIn: false });
            const result = await makeTransport('script', {
                automation: guard,
                openPage: open,
                loginTimeoutMs: 20,
            }).publish({ content: cardContent() });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('session readiness refused');
            expect(result.error).toContain('kk bot login xhs');
            expect(result.metadata?.itcDelivery).toEqual({ schemaVersion: 1, effect: 'none' });
            expect(closed).toHaveLength(1);
            expect(guard.allow('publish').allowed).toBe(false);
        });
    });

    test('state: a corrupt state file is refused, never silently reset to a fresh budget', async () => {
        await seedImages();
        await withGuardDir(async (dir) => {
            const path = join(dir, 'state.json');
            await writeFile(path, 'not json');
            const guard = createAutomationGuard({ statePath: path, now: NOW });
            const transport = makeTransport('script', {
                automation: guard,
                openPage: async () => {
                    throw new Error('unreachable');
                },
            });
            const result = await transport.publish({ content: cardContent() });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('not valid JSON');
            expect(result.error).toContain('delete');
        });
    });

    test('window: the budget reopens once the window has passed, and each event has its own budget', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-xhs-guard-'));
        try {
            const path = join(dir, 'state.json');
            const guard = createAutomationGuard({ statePath: path, now: NOW });
            guard.record('publish');
            expect(guard.allow('publish').allowed).toBe(false);
            // A `check` is a separate budget: publishing must not block the manual session check.
            expect(guard.allow('check').allowed).toBe(true);

            const later = createAutomationGuard({
                statePath: path,
                now: () => new Date(NOW().getTime() + CAP_WINDOW_MS),
            });
            expect(later.allow('publish').allowed).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('state: a non-object, an unparsable timestamp, and an unreadable path all fail closed', async () => {
        await withGuardDir(async (dir) => {
            const arrayPath = join(dir, 'array.json');
            await writeFile(arrayPath, '[1,2]');
            expect(createAutomationGuard({ statePath: arrayPath, now: NOW }).allow('publish').reason).toContain(
                'is not a JSON object',
            );

            const stampPath = join(dir, 'stamp.json');
            await writeFile(stampPath, JSON.stringify({ publish: 'garbage' }));
            expect(createAutomationGuard({ statePath: stampPath, now: NOW }).allow('publish').reason).toContain(
                "unparsable 'publish' timestamp",
            );

            // A directory where the file belongs is not a first run: refuse, never ignore.
            const dirPath = join(dir, 'as-dir');
            await mkdir(dirPath);
            expect(createAutomationGuard({ statePath: dirPath, now: NOW }).allow('publish').reason).toContain(
                'is unreadable',
            );
        });
    });

    test('state: an absent file is the legitimate first run, and record creates the parent directory', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-xhs-guard-'));
        try {
            const path = join(dir, 'nested', 'state.json');
            const guard = createAutomationGuard({ statePath: path, now: NOW });
            expect(guard.allow('publish').allowed).toBe(true);
            guard.record('publish');
            expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ publish: NOW().toISOString() });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('CLI: a manual `check` draws on the shared check budget', async () => {
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        await withGuardDir(async (dir) => {
            const guard = createAutomationGuard({ statePath: join(dir, 'state.json'), now: NOW });
            try {
                const first = await profileCheckMain(
                    ['check', '--headed', '--profile', '/tmp/kk-xhs-check', '--timeout', '50'],
                    fakeLauncher(consoleContext(true)),
                    guard,
                );
                expect(first).toBe(0);
                const second = await profileCheckMain(
                    ['check', '--headed', '--profile', '/tmp/kk-xhs-check', '--timeout', '50'],
                    fakeLauncher(consoleContext(true)),
                    guard,
                );
                expect(second).toBe(1);
                expect(err.text()).toContain("'check' already ran");
            } finally {
                restore();
            }
        });
    });
});

/**
 * ADR-029: one plugin per channel, the four xhs publishing types as validated `operations`.
 * Every case here is offline (fake launcher + fake page): no browser, no network, no publish.
 */
describe('xhs-pub operations (ADR-029 mode dispatch)', () => {
    /** `findShadowControl`/`click` evidence that a publish control was TOUCHED at all. */
    const publishTouches = (log: Array<{ op: string; args: unknown[] }>): string[] => [
        ...log
            .filter((entry) => entry.op === 'findShadowControl')
            .flatMap((entry) => (entry.args[0] as string[]) ?? [])
            .filter((label) => label === '发布'),
        ...log
            .filter((entry) => entry.op === 'click')
            .map((entry) => String(entry.args[0]))
            .filter((selector) => selector === 'button:has-text("发布")'),
    ];

    /** Where a draft save control was resolved or clicked (shadow label read, or a light click). */
    const draftTouches = (log: Array<{ op: string; args: unknown[] }>): string[] => [
        ...log
            .filter((entry) => entry.op === 'findShadowControl')
            .flatMap((entry) => (entry.args[0] as string[]) ?? [])
            .filter((label) => DRAFT_LABELS.has(label)),
        ...log
            .filter((entry) => entry.op === 'click')
            .map((entry) => String(entry.args[0]))
            .filter((selector) => [...DRAFT_LABELS].some((label) => selector.includes(label))),
    ];

    /** Exactly one publish click: the shadow bar's `发布` or 写长文's light-DOM `发布`. */
    const publishClicks = (log: Array<{ op: string; args: unknown[] }>): number =>
        log.filter((entry) => entry.op === 'clickAt').length +
        log.filter((entry) => entry.op === 'click' && String(entry.args[0]) === 'button:has-text("发布")').length -
        // The image tab entry click also lands on clickAt; the submit click is the LAST one.
        (log.some((entry) => entry.op === 'boundingBoxesOnScreen') ? 1 : 0);

    interface ModeCase {
        operation: XhsOperation;
        seed: () => Promise<void>;
        content: (over?: Partial<Content>) => Content;
        /** Valid but for the one artifact/field the mode cannot run without. */
        missing: () => Content;
        missingError: string;
    }

    const IMAGE_TEXT_CASE: ModeCase = {
        operation: '上传图文',
        seed: () => seedImages(),
        content: (over) => modeContent({ images: [{ path: img(0) }, { path: img(1) }] }, over),
        missing: () => modeContent({}),
        missingError: 'metadata.images',
    };
    const VIDEO_CASE: ModeCase = {
        operation: '上传视频',
        seed: seedMedia,
        content: (over) => modeContent({ video: { path: video } }, over),
        missing: () => modeContent({ video: { path: join(tmpRoot, 'absent.mp4') } }),
        missingError: 'video validation',
    };
    const ARTICLE_CASE: ModeCase = {
        operation: '写长文',
        seed: async () => {},
        content: (over) => modeContent({}, over),
        missing: () => modeContent({}, { body: '   ' }),
        missingError: 'non-empty',
    };
    const PODCAST_CASE: ModeCase = {
        operation: '发播客',
        seed: seedMedia,
        content: (over) => modeContent({ audio: { path: audio }, coverImage: cover }, over),
        missing: () => modeContent({ audio: { path: audio } }),
        missingError: 'coverImage',
    };

    const MODE_CASES: readonly ModeCase[] = [IMAGE_TEXT_CASE, VIDEO_CASE, ARTICLE_CASE, PODCAST_CASE];

    const run = async (
        mode: ModeCase,
        opts: { content?: Content; state?: Partial<FakeState> } = {},
    ): Promise<{
        result: Awaited<ReturnType<XhsBrowserTransport['publish']>>;
        log: Array<{ op: string; args: unknown[] }>;
    }> => {
        await mode.seed();
        const { open, calls } = makeOpenPage({ ...happy, ...opts.state });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({
            content: opts.content ?? mode.content(),
            options: { operation: mode.operation },
        });
        return { result, log: calls[0] ?? [] };
    };

    test('an undeclared operation fails by name, with zero launches and no profile work', async () => {
        await seedImages();
        const { open, closed, calls } = makeOpenPage(happy);
        const t = makeTransport('script', { openPage: open });
        const result = await t.publish({ content: cardContent({ operation: '发视频' }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unsupported operation '发视频'");
        // The refusal names the declared list, so the caller can see what this channel accepts.
        expect(result.error).toContain('上传图文, 上传视频, 写长文, 发播客');
        // The profile-speaker's wording never appears: no preflight and no browser were reached.
        expect(result.error).not.toContain('preflight witness');
        expect(calls).toHaveLength(0);
        expect(closed).toHaveLength(0);
    });

    test('an absent operation defaults to 上传图文 (the mode this channel shipped with)', async () => {
        await seedImages();
        const { open, calls } = makeOpenPage({ ...happy });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        expect(result.metadata?.operation).toBe('上传图文');
        const entered = (calls[0] ?? []).filter((entry) => entry.op === 'boundingBoxesOnScreen');
        expect(entered[0]?.args[0]).toBe('text=上传图文');
    });

    test('options.operation wins over content.metadata.operation', async () => {
        await seedImages();
        const { open } = makeOpenPage({ ...happy });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        // The metadata names a mode whose artifacts are absent; the options override must win, so
        // the run completes as an image-text note instead of failing on the missing audio.
        const result = await t.publish({
            content: cardContent({ operation: '发播客' }),
            options: { operation: '上传图文' },
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.operation).toBe('上传图文');
    });

    for (const mode of MODE_CASES) {
        test(`${mode.operation}: draft path enters the mode, saves, and reports the observed signal`, async () => {
            const { result, log } = await run(mode);
            expect(result.ok).toBe(true);
            expect(result.metadata?.operation).toBe(mode.operation);
            expect(result.metadata?.driver).toBe('script');
            expect(result.metadata?.publishStatus).toBe('draft');
            expect(result.metadata?.profileDir).toBe(PROFILE);
            expect(result.metadata?.draftControl).toBe('暂存离开');
            expect(result.metadata?.draftSignal).toBe('draft-row');
            expect(result.message).toContain(PROFILE);
            const ops = log.map((entry) => entry.op);
            // Mode entry: the image tab uses a raw centre click (clone-proof), the other modes
            // wait for the tab bar to mount then click an on-screen tab.
            if (mode.operation === '上传图文') {
                expect(ops.indexOf('boundingBoxesOnScreen')).toBeGreaterThan(-1);
            } else {
                expect(ops.indexOf('countOnScreen')).toBeGreaterThan(-1);
                expect(ops.indexOf('countOnScreen')).toBeLessThan(ops.indexOf('clickInViewport'));
            }
            expect(draftTouches(log).length).toBeGreaterThan(0);
            // Rail: a draft run never touches a publish control.
            expect(publishTouches(log)).toEqual([]);
        });

        test(`${mode.operation}: an unobserved signal fails naming the label and the deadline`, async () => {
            const { result } = await run(mode, {
                // The console dismisses the editor but neither moves the counter nor prints a
                // stamp, and no toast appears.
                state: { draftSaveIsSilent: true, draftSaveStampsNothing: true },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('draft confirmation');
            expect(result.error).toContain('暂存离开');
            expect(result.error).toContain('within 10ms');
            expect(result.error).toContain('保存成功');
        });

        test(`${mode.operation}: an unknown publishStatus fails before any launch`, async () => {
            await mode.seed();
            const { open, closed, calls } = makeOpenPage(happy);
            const t = makeTransport('script', { openPage: open });
            const result = await t.publish({
                content: mode.content({ metadata: { ...mode.content().metadata, publishStatus: 'friends' } }),
                options: { operation: mode.operation },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('publishStatus');
            expect(result.error).not.toContain('preflight witness');
            expect(calls).toHaveLength(0);
            expect(closed).toHaveLength(0);
        });

        test(`${mode.operation}: a missing artifact fails before any launch, naming it`, async () => {
            await mode.seed();
            const { open, closed, calls } = makeOpenPage(happy);
            const t = makeTransport('script', { openPage: open });
            const result = await t.publish({ content: mode.missing(), options: { operation: mode.operation } });
            expect(result.ok).toBe(false);
            expect(result.error).toContain(mode.missingError);
            expect(result.error).not.toContain('preflight witness');
            expect(calls).toHaveLength(0);
            expect(closed).toHaveLength(0);
        });

        test(`${mode.operation}: publishStatus 'public' clicks ONE publish control`, async () => {
            const { result, log } = await run(mode, {
                content: mode.content({ metadata: { ...mode.content().metadata, publishStatus: 'public' } }),
            });
            expect(result.ok).toBe(true);
            expect(result.metadata?.publishStatus).toBe('public');
            expect(result.metadata?.publishControl).toBe('发布');
            // The action bar's location is a property of the mode, for `发布` as well as `暂存离开`.
            expect(result.metadata?.publishPath).toBe(mode.operation === '写长文' ? 'light' : 'shadow');
            expect(publishClicks(log)).toBe(1);
        });
    }

    test('上传图文: the 图文 grid cap (18) fails before any launch', async () => {
        const { open, closed, calls } = makeOpenPage(happy);
        const t = makeTransport('script', { openPage: open });
        const result = await t.publish({ content: cardContent({}, 19) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('≤18');
        expect(calls).toHaveLength(0);
        expect(closed).toHaveLength(0);
    });

    test('上传图文: an over-limit body (1000) fails before any launch', async () => {
        const { open, closed } = makeOpenPage(happy);
        const t = makeTransport('script', { openPage: open });
        const result = await t.publish({
            content: modeContent({ images: [{ path: img(0) }] }, { body: 'x'.repeat(1001) }),
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('body validation');
        expect(result.error).toContain('≤1000');
        expect(closed).toHaveLength(0);
    });

    test('上传图文: an over-limit title (20) fails before any launch', async () => {
        const { open, closed } = makeOpenPage(happy);
        const t = makeTransport('script', { openPage: open });
        const result = await t.publish({
            content: modeContent({ images: [{ path: img(0) }] }, { title: 'x'.repeat(21) }),
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('title validation');
        expect(result.error).toContain('≤20');
        expect(closed).toHaveLength(0);
    });

    test('上传视频: one video is uploaded into the video input (multiple=false) and the note is saved', async () => {
        const { result, log } = await run(VIDEO_CASE);
        expect(result.ok).toBe(true);
        expect(result.metadata?.artifactPaths).toEqual([video]);
        expect(result.metadata?.imageCount).toBeUndefined();
        const uploads = log.filter((entry) => entry.op === 'setInputFiles');
        expect(uploads).toHaveLength(1);
        expect(String(uploads[0]?.args[0])).toContain('.mp4');
        expect(uploads[0]?.args[1]).toEqual([video]);
        const entered = log.filter((entry) => entry.op === 'clickInViewport');
        expect(entered[0]?.args[0]).toBe('div.creator-tab:has-text("上传视频")');
    });

    test('写长文: authors in place (no 导入链接, no upload), applies 一键排版', async () => {
        await seedMedia();
        const { open, calls } = makeOpenPage({ ...happy });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: modeContent({}, { body: '# 长文标题\n\n正文段落' }),
            options: { operation: '写长文' },
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.artifactPaths).toEqual([]);
        const log = calls[0] ?? [];
        // The raw markdown is authored in the editor: no upload, a real paste (the shared helper's
        // clipboard script), and the link-import path is excluded by decision (it would put 公众号
        // publishing in the critical path before xhs ever sees the content).
        expect(log.filter((entry) => entry.op === 'setInputFiles')).toEqual([]);
        expect(log.filter((entry) => entry.op === 'evaluate').length).toBeGreaterThan(0);
        const clicked = log.filter((entry) => entry.op === 'click').map((entry) => String(entry.args[0]));
        expect(clicked).toContain('text=新的创作');
        // 一键排版 applies the layout directly on xhs — measured live: the click produced no option
        // menu, and the 保留源格式/匹配目标格式/仅保留文本 trio is WeChat MP's option set. Requiring an
        // option here failed a real draft run (dogfood 2026-10-05), so the flow must click the
        // control and never look for an option.
        expect(clicked.some((selector) => selector.includes('一键排版'))).toBe(true);
        expect(clicked.some((selector) => selector.includes('匹配目标格式'))).toBe(false);
        expect(clicked.some((selector) => selector.includes('导入链接'))).toBe(false);
    });

    test('写长文 saves through the LIGHT-DOM 暂存离开; 图文 only through the closed shadow bar', async () => {
        const article = await run(ARTICLE_CASE);
        expect(article.result.metadata?.draftPath).toBe('light');
        expect(article.result.metadata?.draftControl).toBe('暂存离开');
        // The only coordinate clicks belong to verifyDraft's reopen (overlay-proofed nav + edit,
        // 2026-11-11); the article's SAVE itself is a light-DOM click, never clickAt.
        expect(article.log.filter((entry) => entry.op === 'clickAt')).toHaveLength(2);

        const imageText = await run(IMAGE_TEXT_CASE);
        expect(imageText.result.metadata?.draftPath).toBe('shadow');
        expect(imageText.result.metadata?.draftClick).toBe('606,855');
    });

    test('发播客: the modal takes audio (ack) and cover (native chooser), then 去发布 advances and the bar saves', async () => {
        const { result, log } = await run(PODCAST_CASE);
        expect(result.ok).toBe(true);
        expect(result.metadata?.artifactPaths).toEqual([audio, cover]);
        const uploads = log.filter((entry) => entry.op === 'setInputFiles').map((entry) => String(entry.args[0]));
        expect(uploads).toHaveLength(2);
        expect(uploads[0]).toContain('.mp3');
        // Measured 2026-11-06: only the audio registers through a raw input assignment; the cover
        // needs the native file chooser the site opens, so it rides `waitForEvent('filechooser')`.
        expect(uploads[1]).toBe('filechooser');
        const coverDelivery = log.filter((entry) => entry.op === 'setInputFiles')[1];
        expect(String(coverDelivery?.args[1])).toContain('cover.png');
        // The RSS path is excluded by decision: no audio-card upload, no feed subscription.
        expect(log.some((entry) => entry.op === 'click' && String(entry.args[0]).includes('添加RSS订阅'))).toBe(false);
        // The advance click is now part of the draft path (it opens the editor, not a publish).
        const clicked = log.filter((entry) => entry.op === 'click').map((entry) => String(entry.args[0]));
        expect(clicked.some((selector) => selector.includes('去发布'))).toBe(true);
        expect(publishTouches(log)).toEqual([]);
    });

    test('发播客: a silent cover chooser fails naming the native file chooser', async () => {
        const { result, log } = await run(PODCAST_CASE, {
            state: { podcastCoverChooserSilent: true },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('native file chooser');
        // The rail held: the advance control was never reached behind a failed attach.
        const clicked = log.filter((entry) => entry.op === 'click').map((entry) => String(entry.args[0]));
        expect(clicked.some((selector) => selector.includes('去发布'))).toBe(false);
        expect(publishTouches(log)).toEqual([]);
    });

    test('发播客: an explicit public request may use the modal advance before publishing', async () => {
        const { result, log } = await run(PODCAST_CASE, {
            content: modeContent({ audio: { path: audio }, coverImage: cover, publishStatus: 'public' }),
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
        const clicked = log.filter((entry) => entry.op === 'click').map((entry) => String(entry.args[0]));
        expect(clicked.some((selector) => selector.includes('去发布'))).toBe(true);
    });

    test('发播客: falls back to triggering the cover card DOM click when the initial coordinate click leaves the chooser pending', async () => {
        await PODCAST_CASE.seed();
        const fake = makeFakePage({ ...happy });
        let resolveChooser: ((val: unknown) => void) | null = null;
        const page: XhsPage = {
            ...fake.page,
            waitForEvent: async (event) => {
                if (event !== 'filechooser') return null;
                return new Promise((resolve) => {
                    resolveChooser = resolve;
                });
            },
            mouse: {
                click: async (x, y) => {
                    await fake.page.mouse?.click(x, y);
                    if (x === 450 && y === 200 && resolveChooser) {
                        resolveChooser({
                            setFiles: async (paths: readonly string[] | string) => {
                                await fake.page.setInputFiles('input[accept*=".png"]', paths);
                            },
                        });
                    }
                },
            },
            evaluate: async (expression) => {
                if (expression.includes('设置封面')) {
                    return JSON.stringify({ x: 450, y: 200 });
                }
                return fake.page.evaluate(expression);
            },
        };
        const t = makeTransport('script', {
            openPage: async () => ({ page, close: async () => {} }),
            stepTimeoutMs: 1000,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: PODCAST_CASE.content(),
            options: { operation: '发播客' },
        });
        expect(result.ok).toBe(true);
    });

    test('发播客: leavePodcastModal falls back to DOM click when a modal mask intercepts pointer events on 去发布', async () => {
        await PODCAST_CASE.seed();
        const state: FakeState = { ...happy };
        const fake = makeFakePage(state);
        const page: XhsPage = {
            ...fake.page,
            locator: (selector) => {
                const inner = fake.page.locator(selector);
                if (selector.includes('去发布') && !selector.includes('disabled')) {
                    const first = inner.first();
                    return {
                        ...inner,
                        first: () => ({
                            ...first,
                            click: async () => {
                                throw new Error(
                                    'click: Timeout 2500ms exceeded. <button class="cancel-btn"> from <div class="d-modal-mask"> subtree intercepts pointer events',
                                );
                            },
                        }),
                    };
                }
                return inner;
            },
            evaluate: async (expression) => {
                if (expression.includes('去发布') && expression.includes('cancel-btn')) {
                    // Simulate closing the podcast modal via the DOM fallback click on 去发布.
                    await fake.page.locator('button:has-text("去发布")').first().click();
                    return JSON.stringify({ clickedAdvance: true });
                }
                return fake.page.evaluate(expression);
            },
        };
        const t = makeTransport('script', {
            openPage: async () => ({ page, close: async () => {} }),
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: PODCAST_CASE.content(),
            options: { operation: '发播客' },
        });
        expect(result.ok).toBe(true);
    });

    test('发播客: a missed light-DOM advance probe recovers through the DOM fallback re-click inside the wait loop', async () => {
        await PODCAST_CASE.seed();
        const state: FakeState = { ...happy };
        const fake = makeFakePage(state);
        let fallbackCalls = 0;
        let advanceProbeMiss = false;
        const page: XhsPage = {
            ...fake.page,
            locator: (selector) => {
                const inner = fake.page.locator(selector);
                // podcastAdvanceReady needs the plain 去发布 probe attached; once its disabled
                // probe runs, the light-DOM candidates miss, so clickLightControl reports
                // ok:false instead of throwing through the catch arm.
                if (selector.includes('去发布')) {
                    if (selector.includes('disabled')) {
                        advanceProbeMiss = true;
                        return inner;
                    }
                    if (advanceProbeMiss) {
                        return {
                            ...inner,
                            count: async () => 0,
                            first: () => ({ ...inner.first(), count: async () => 0 }),
                        };
                    }
                }
                return inner;
            },
            evaluate: async (expression) => {
                if (expression.includes('kk-counter-')) {
                    // The counter probes die mid-read: the gates treat an unreadable counter as
                    // absent, not fatal.
                    throw new Error('counter probe: execution context destroyed');
                }
                if (expression.includes('去发布') && expression.includes('cancel-btn')) {
                    fallbackCalls += 1;
                    // The first fallback click (before the wait loop) does not close the modal;
                    // the wait-loop re-click does — the stale-modal recovery path 0236 R3 names.
                    // The close must go through the fake's own click handler so its internal
                    // state (not the outer capture) actually flips.
                    if (fallbackCalls >= 2) await fake.page.locator('button:has-text("去发布")').first().click();
                    return JSON.stringify({ clickedAdvance: fallbackCalls >= 2 });
                }
                return fake.page.evaluate(expression);
            },
        };
        const t = makeTransport('script', {
            openPage: async () => ({ page, close: async () => {} }),
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: PODCAST_CASE.content(),
            options: { operation: '发播客' },
        });
        expect(result.ok).toBe(true);
        expect(fallbackCalls).toBe(2);
    });

    test('发播客: a modal that never closes reports the stayed-open diagnostic instead of hanging', async () => {
        await PODCAST_CASE.seed();
        const state: FakeState = { ...happy };
        const fake = makeFakePage(state);
        let advanceProbeMiss = false;
        const page: XhsPage = {
            ...fake.page,
            locator: (selector) => {
                const inner = fake.page.locator(selector);
                // Same phase-keyed miss as the recovery test: podcastAdvanceReady passes first,
                // then the light-DOM candidates vanish so the fallback path is forced.
                if (selector.includes('去发布')) {
                    if (selector.includes('disabled')) {
                        advanceProbeMiss = true;
                        return inner;
                    }
                    if (advanceProbeMiss) {
                        return {
                            ...inner,
                            count: async () => 0,
                            first: () => ({ ...inner.first(), count: async () => 0 }),
                        };
                    }
                }
                return inner;
            },
            evaluate: async (expression) => {
                if (expression.includes('去发布') && expression.includes('cancel-btn')) {
                    // The fallback clicks land but the modal never closes: the wait loop must
                    // exhaust and name what it saw, not retry forever.
                    return JSON.stringify({ clickedAdvance: false, buttons: [] });
                }
                return fake.page.evaluate(expression);
            },
        };
        const t = makeTransport('script', {
            openPage: async () => ({ page, close: async () => {} }),
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: PODCAST_CASE.content(),
            options: { operation: '发播客' },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('stayed open');
    });

    test('发播客: audio assignment without the 上传成功 ack fails the compose before the cover stage', async () => {
        await PODCAST_CASE.seed();
        const state: FakeState = { ...happy };
        const fake = makeFakePage(state);
        const page: XhsPage = {
            ...fake.page,
            locator: (selector) => {
                const inner = fake.page.locator(selector);
                // The audio card registers but its ack probe never lights up: the assignment did
                // not take, and compose must stop before the cover chooser stalls on a disabled
                // 去发布.
                if (selector.includes('上传成功')) {
                    return {
                        ...inner,
                        count: async () => {
                            throw new Error('ack probe: execution context destroyed');
                        },
                        first: () => ({ ...inner.first(), count: async () => 0 }),
                    };
                }
                return inner;
            },
        };
        const t = makeTransport('script', {
            openPage: async () => ({ page, close: async () => {} }),
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: PODCAST_CASE.content(),
            options: { operation: '发播客' },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('上传成功');
    });

    test('发播客: an advance button stuck disabled after both cards attach names the unaccepted cards', async () => {
        await PODCAST_CASE.seed();
        const state: FakeState = { ...happy };
        const fake = makeFakePage(state);
        const page: XhsPage = {
            ...fake.page,
            locator: (selector) => {
                const inner = fake.page.locator(selector);
                // The disabled-state probe dies mid-read: the enabled check stays false through
                // the whole window and the diagnostic must survive the probe failure.
                if (selector.includes('disabled')) {
                    return {
                        ...inner,
                        count: async () => {
                            throw new Error('probe: execution context destroyed');
                        },
                    };
                }
                return inner;
            },
        };
        const t = makeTransport('script', {
            openPage: async () => ({ page, close: async () => {} }),
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: PODCAST_CASE.content(),
            options: { operation: '发播客' },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('stayed disabled');
    });

    test('发播客: a cover card without a bounding box fails the coordinate click loudly', async () => {
        await PODCAST_CASE.seed();
        const state: FakeState = { ...happy };
        const fake = makeFakePage(state);
        const page: XhsPage = {
            ...fake.page,
            locator: (selector) => {
                const inner = fake.page.locator(selector);
                // The cover card is attached but geometry-less: the coordinate click cannot be
                // aimed, so the guard must name the miss instead of clicking (0,0).
                if (selector.includes('设置封面')) {
                    return {
                        ...inner,
                        first: () => ({ ...inner.first(), boundingBox: async () => null }),
                    };
                }
                return inner;
            },
        };
        const t = makeTransport('script', {
            openPage: async () => ({ page, close: async () => {} }),
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: PODCAST_CASE.content(),
            options: { operation: '发播客' },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('no bounding box');
    });

    test('发播客: a page without a raw mouse refuses the cover-card coordinate click', async () => {
        await PODCAST_CASE.seed();
        const state: FakeState = { ...happy };
        const fake = makeFakePage(state);
        const page: XhsPage = { ...fake.page };
        // The modal's cover card only responds to coordinate clicks; a driver without the raw
        // mouse seam must fail loud, not silently skip the attach.
        delete (page as { mouse?: unknown }).mouse;
        const t = makeTransport('script', {
            openPage: async () => ({ page, close: async () => {} }),
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: PODCAST_CASE.content(),
            options: { operation: '发播客' },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('raw mouse');
    });

    test('image mode entry rejects a driver that cannot read viewport boxes or click coordinates', async () => {
        await IMAGE_TEXT_CASE.seed();
        const state: FakeState = { ...happy };
        const fake = makeFakePage(state);
        const bare: XhsPage = { ...fake.page };
        delete (bare as { clickAt?: unknown }).clickAt;
        delete (bare as { boundingBoxesOnScreen?: unknown }).boundingBoxesOnScreen;
        const t = makeTransport('script', {
            openPage: async () => ({ page: bare, close: async () => {} }),
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: IMAGE_TEXT_CASE.content(),
            options: { operation: '上传图文' },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain('cannot read viewport boxes');
    });

    test('the console settle window absorbs a straggler context response at listener registration', async () => {
        await IMAGE_TEXT_CASE.seed();
        const state: FakeState = { ...happy };
        const fake = makeFakePage(state);
        const page: XhsPage = {
            ...fake.page,
            // A spectrum response lands the instant the settle listener registers — the quiet
            // window must restart from it, not treat the mount as already-settled.
            offContextResponse: () => {},
            onContextResponse: (handler) => {
                handler({
                    status: () => 200,
                    url: () => 'https://ros-upload.xiaohongshu.com/spectrum/0',
                });
            },
        };
        const t = makeTransport('script', {
            openPage: async () => ({ page, close: async () => {} }),
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({
            content: IMAGE_TEXT_CASE.content(),
            options: { operation: '上传图文' },
        });
        expect(result.ok).toBe(true);
    });
});

/**
 * 0236 (ADR-025 amendment 2026-10-09, option A): one headed visit composes the 上传图文 note and the
 * episode's 发播客 note under ONE `allow`/`record('publish')`. The 发播客 Content rides the primary
 * Content's `metadata.followUps`, and each operation gets its own Result entry.
 */
describe('xhs-pub visit follow-ups (0236 R0/R1/R2 — one visit, two notes)', () => {
    /** 0236: the episode's artifacts as the publish-prep Content carries them (final mp3 + cover). */
    const episodeMp3 = join(tmpRoot, '30-audio/20260101_11_episode.mp3');
    const episodeCover = join(tmpRoot, '23-cover/20260101_07_cover_cover.png');

    async function seedEpisode(): Promise<void> {
        await mkdir(join(tmpRoot, '30-audio'), { recursive: true });
        await mkdir(join(tmpRoot, '23-cover'), { recursive: true });
        await Promise.all([writeFile(episodeMp3, 'mp3'), writeFile(episodeCover, 'png')]);
    }

    /**
     * The 发播客 Content `dailyPublishXhs` builds: the publish-prep Content plus `metadata.operation`,
     * the channel's `metadata.audio` (the same final mp3 the prep spells `audioFile`) and
     * `publishStatus`.
     */
    function podcastNote(over: Record<string, unknown> = {}): Content {
        return {
            title: '每日AI乱炖',
            body: '本期三件事',
            format: 'text',
            metadata: {
                audioFile: episodeMp3,
                coverImage: episodeCover,
                audio: episodeMp3,
                operation: '发播客',
                publishStatus: 'draft',
                ...over,
            },
        };
    }

    const visitedPage = (calls: Array<Array<{ op: string; args: unknown[] }>>) => calls[0] ?? [];
    const clicked = (log: Array<{ op: string; args: unknown[] }>): string[] =>
        log.filter((entry) => entry.op === 'click').map((entry) => String(entry.args[0]));
    const uploads = (log: Array<{ op: string; args: unknown[] }>): unknown[] =>
        log.filter((entry) => entry.op === 'setInputFiles').map((entry) => entry.args[1]);

    function visitTransport(open: OpenPage, over: ConstructorParameters<typeof XhsBrowserTransport>[1] = {}) {
        return makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 500,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            ...over,
        });
    }

    test('0236 R0/R1/R2: one visit composes the 图文 note and its 发播客 follow-up in the same session', async () => {
        await seedImages();
        await seedEpisode();
        const { open, closed, calls } = makeOpenPage({ ...happy });
        const t = visitTransport(open);

        const result = await t.publish({ content: cardContent({ followUps: [podcastNote()] }) });

        // The primary 上传图文 draft is the visit's own Result, exactly as before 0236.
        expect(result.ok).toBe(true);
        expect(result.metadata?.operation).toBe('上传图文');
        // R0: ONE visit — one browser, opened once, with one Result entry per operation.
        expect(closed).toHaveLength(1);
        expect(calls).toHaveLength(1);
        const followUps = result.metadata?.followUps as Result[];
        expect(followUps).toHaveLength(1);
        expect(followUps[0]?.ok).toBe(true);
        expect(followUps[0]?.metadata?.operation).toBe('发播客');
        expect(followUps[0]?.metadata?.publishStatus).toBe('draft');
        // R1/R2: that episode's mp3 and that episode's cover, after the 图文 batch, as one episode.
        expect(uploads(visitedPage(calls))).toEqual([[img(0), img(1)], [episodeMp3], [episodeCover]]);
        expect(followUps[0]?.metadata?.artifactPaths).toEqual([episodeMp3, episodeCover]);
        // The measured rail: on a draft run the advance opens the editor, and the shadow
        // `暂存离开` saves — no publish touch ever happens before the save decision.
        expect(clicked(visitedPage(calls)).some((selector) => selector.includes('去发布'))).toBe(true);
        expect(clicked(visitedPage(calls)).some((selector) => selector === 'button:has-text("发布")')).toBe(false);
    });

    test('0236 R0: the visit spends ONE publish record, whatever the number of notes', async () => {
        await seedImages();
        await seedEpisode();
        const guard = createAutomationGuard({ statePath: AUTOMATION_STATE });
        const recorded: string[] = [];
        const counting: AutomationGuard = {
            allow: (event) => guard.allow(event),
            record: (event) => {
                recorded.push(event);
                guard.record(event);
            },
        };
        const { open } = makeOpenPage({ ...happy });
        const result = await visitTransport(open, { automation: counting }).publish({
            content: cardContent({ followUps: [podcastNote()] }),
        });
        expect(result.ok).toBe(true);
        expect((result.metadata?.followUps as Result[])?.[0]?.ok).toBe(true);
        // Two notes, one cap entry: the guard is consumed once and the state file holds one stamp.
        expect(recorded).toEqual(['publish']);
        const state = JSON.parse(readFileSync(AUTOMATION_STATE, 'utf-8')) as Record<string, string>;
        expect(Object.keys(state)).toEqual(['publish']);
        // The window is spent as one visit: a second call is refused before any browser opens.
        const never = async () => {
            throw new Error('openPage must not be reached');
        };
        const second = await visitTransport(never, {
            automation: createAutomationGuard({ statePath: AUTOMATION_STATE }),
        }).publish({ content: cardContent() });
        expect(second.ok).toBe(false);
        expect(second.error).toContain('automation cap');
    });

    test('0236 R3 (measured 2026-11-06): the modal walk advances the 发播客 follow-up to its own draft save', async () => {
        await seedImages();
        await seedEpisode();
        const { open, calls } = makeOpenPage({ ...happy, podcastCoverChooserSilent: true });
        const result = await visitTransport(open).publish({ content: cardContent({ followUps: [podcastNote()] }) });

        // A failed 发播客 entry stays non-blocking: the 图文 draft the visit was opened for stands.
        expect(result.ok).toBe(true);
        expect(result.metadata?.draftSignal).toBe('draft-row');
        const followUps = result.metadata?.followUps as Result[];
        expect(followUps[0]?.ok).toBe(false);
        // The failure names the measured mechanism: the cover card never opened its chooser.
        expect(followUps[0]?.error).toContain('native file chooser');
        // A failed entry still names its operation, so the caller can tell which note fell.
        expect(followUps[0]?.metadata?.operation).toBe('发播客');
        // The rail held: the advance was never reached behind a failed attach.
        expect(clicked(visitedPage(calls)).some((selector) => selector.includes('去发布'))).toBe(false);
    });

    test('0236: a follow-up that fails pre-browser validation is its own failed entry, never a visit', async () => {
        await seedImages();
        const { open, calls } = makeOpenPage({ ...happy });
        const t = visitTransport(open);
        // The prep Content carried no episode audio: nothing for the 发播客 mode to upload.
        const result = await t.publish({
            content: cardContent({ followUps: [podcastNote({ audioFile: undefined, audio: undefined })] }),
        });
        expect(result.ok).toBe(true);
        const followUps = result.metadata?.followUps as Result[];
        expect(followUps[0]?.ok).toBe(false);
        expect(followUps[0]?.error).toContain('metadata.audio');
        expect(followUps[0]?.metadata?.operation).toBe('发播客');
        // The refused note never touched the console: no 上传音频, and no second upload call.
        expect(clicked(visitedPage(calls)).some((selector) => selector.includes('上传音频'))).toBe(false);
        expect(uploads(visitedPage(calls))).toEqual([[img(0), img(1)]]);
    });

    test('0236: an unplannable follow-up is refused by name, and a malformed followUps list opens no browser', async () => {
        await seedImages();
        // A malformed list is a caller error: it fails loud before any browser is launched.
        const never = async () => {
            throw new Error('openPage must not be reached');
        };
        const malformed = await visitTransport(never).publish({
            content: cardContent({ followUps: '发播客' }),
        });
        expect(malformed.ok).toBe(false);
        expect(malformed.error).toContain('followUps validation');
        expect(malformed.error).toContain('must be an array');

        const { open, calls } = makeOpenPage({ ...happy });
        // A non-Content entry and an undeclared operation: each is its own refused entry.
        const result = await visitTransport(open).publish({
            content: cardContent({ followUps: ['发播客', podcastNote({ operation: '发视频' })] }),
        });
        expect(result.ok).toBe(true);
        const followUps = result.metadata?.followUps as Result[];
        expect(followUps).toHaveLength(2);
        expect(followUps[0]?.ok).toBe(false);
        expect(followUps[0]?.error).toContain('followUps[0] is not a Content object');
        expect(followUps[1]?.ok).toBe(false);
        expect(followUps[1]?.error).toContain("unsupported operation '发视频'");
        // A refused entry carries the name it was planned under: its declared operation, else its slot.
        expect(followUps.map((entry) => entry.metadata?.operation)).toEqual(['followUps[0]', '发视频']);
        // Neither refused entry reached the console: only the primary's own upload happened.
        expect(uploads(visitedPage(calls))).toEqual([[img(0), img(1)]]);
    });
});

/**
 * The mode-entry hazard (0199 §1) and the signal-scoping rail (0199 §4) as regressions: both are
 * modelled by the fake so a naive implementation fails these tests rather than passing them.
 */
describe('xhs-pub mode entry and signal scoping (0199 evidence)', () => {
    /** Tab geometry of the live console: two off-screen clones per tab, then the real node. */
    const TAB_LAYOUT: Record<string, Array<{ x: number; y: number }>> = {
        'div.creator-tab': [
            { x: -9726, y: -9918 },
            { x: -9726, y: 12 },
            { x: 40, y: 24 },
            { x: 160, y: 24 },
            { x: 280, y: 24 },
            { x: 400, y: 24 },
        ],
        'div.creator-tab:has-text("写长文")': [
            { x: -9726, y: -9918 },
            { x: -9726, y: 12 },
            { x: 280, y: 24 },
        ],
    };

    function cloneModelRaw(selectors: Record<string, Array<{ x: number; y: number }>>, clicks: string[]) {
        return {
            goto: async () => {},
            locator: (selector: string) => ({
                count: async () => selectors[selector]?.length ?? 0,
                nth: (index: number) => ({
                    boundingBox: async () => {
                        const box = selectors[selector]?.[index];
                        return box === undefined ? null : { ...box, width: 100, height: 32 };
                    },
                    click: async () => void clicks.push(`${selector}#${index}`),
                }),
                first: () => ({
                    count: async () => 0,
                    isVisible: async () => false,
                    fill: async () => {},
                    click: async () => {},
                }),
            }),
            setInputFiles: async () => {},
            waitForSelector: async () => null,
            url: () => 'https://creator.xiaohongshu.com/publish/publish',
            viewportSize: () => ({ width: 1280, height: 800 }),
            evaluate: async () => true,
            mouse: { click: async () => {} },
        };
    }

    test('mode entry clicks the ON-SCREEN tab, never the aria-hidden or off-screen clone', async () => {
        const clicks: string[] = [];
        const page = wrapPlaywrightPage(cloneModelRaw(TAB_LAYOUT, clicks));
        // The bar is only "mounted" once all four tabs are laid out on screen: the two clones per
        // tab are off-viewport (x=-9726) and are exactly what `.first()` would have bound to.
        expect(await page.countOnScreen('div.creator-tab')).toBe(CREATOR_TAB_COUNT);
        await clickCreatorTab(page, '写长文');
        expect(clicks).toEqual(['div.creator-tab:has-text("写长文")#2']);
    });

    test('a tab bar that never mounts fails loud instead of clicking a clone', async () => {
        const clicks: string[] = [];
        const page = wrapPlaywrightPage(
            cloneModelRaw(
                {
                    'div.creator-tab': [
                        { x: -9726, y: -9918 },
                        { x: -9726, y: 12 },
                    ],
                },
                clicks,
            ),
        );
        await expect(clickCreatorTab(page, '写长文', { timeoutMs: 60, pollMs: 10 })).rejects.toThrow('did not mount');
        expect(clicks).toEqual([]);
    });

    /** The narrowest page that satisfies the seam, for the entry helper's own failure rails. */
    function barePage(over: Partial<XhsPage> = {}): XhsPage {
        return {
            goto: async () => {},
            locator: () => ({
                count: async () => 0,
                first: () => ({
                    boundingBox: async () => null,
                    count: async () => 0,
                    isVisible: async () => false,
                    fill: async () => {},
                    click: async () => {},
                }),
            }),
            setInputFiles: async () => {},
            waitForSelector: async () => null,
            url: () => 'https://creator.xiaohongshu.com/publish/publish',
            evaluate: async () => true,
            countOnScreen: async () => CREATOR_TAB_COUNT,
            ...over,
        };
    }

    test('mode entry fails loud when the driver cannot read viewport geometry', async () => {
        // Without geometry the on-screen node cannot be told from its clones, so nothing is clicked.
        await expect(clickCreatorTab(barePage(), '上传图文')).rejects.toThrow('cannot read viewport geometry');
    });

    test('mode entry reports the on-screen tab count it saw when the bar never mounts', async () => {
        const page = barePage({
            countOnScreen: async () => {
                throw new Error('element detached');
            },
        });
        await expect(clickCreatorTab(page, '写长文', { timeoutMs: 40, pollMs: 10 })).rejects.toThrow(
            `0 of ${CREATOR_TAB_COUNT} on-screen`,
        );
    });

    test('the selector probes fail loud at their deadline for attached-only and visible-only reads', async () => {
        const unreadable = barePage({
            locator: () => ({
                count: async () => {
                    throw new Error('element detached');
                },
                first: () => ({
                    boundingBox: async () => null,
                    count: async () => 0,
                    isVisible: async () => false,
                    fill: async () => {},
                    click: async () => {},
                }),
            }),
        });
        await expect(findAttachedSelector(unreadable, ['input[type="file"]'], 'image file input', 40)).rejects.toThrow(
            'image file input: no matching element observed',
        );
        await expect(findSelector(unreadable, ['div.nope'], 'title input', 40)).rejects.toThrow(
            'title input: no matching element observed',
        );
        await expect(findAttachedSelector(barePage(), ['input[type="file"]'], 'video file input', 40)).rejects.toThrow(
            'video file input: no matching element observed',
        );
    });

    test('a body carrying the toast label is not a draft signal (the probe is container-scoped)', async () => {
        await seedImages();
        const fake = makeFakePage({
            ...happy,
            // The note body the flow just pasted contains the toast label…
            bodyContainsToastLabel: true,
            // …and the console shows no toast, moves no counter and prints no stamp.
            draftSaveIsSilent: true,
            draftSaveStampsNothing: true,
        });
        const unscoped = await fake.page.locator(':text("保存成功")').first().count();
        const scoped = await fake.page.locator('[class*="toast" i] :text("保存成功")').first().count();
        expect(unscoped).toBe(1);
        expect(scoped).toBe(0);

        const open: OpenPage = async () => ({ page: fake.page, close: async () => {} });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
        expect(result.error).toContain('保存成功');
    });

    test('上传图文: a scoped 保存成功 toast is an observed signal on its own', async () => {
        await seedImages();
        const { open } = makeOpenPage({
            ...happy,
            draftToast: true,
            draftSaveIsSilent: true,
            draftSaveStampsNothing: true,
        });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        expect(result.metadata?.draftSignal).toBe('toast:保存成功');
    });
});

describe('xhs-pub profile-check `open` verb (0277, operator-interactive)', () => {
    test('open without --profile is a usage error: exit 2, no browser', async () => {
        const opened: ProfileLaunchRequest[] = [];
        const launcher = fakeLauncher(consoleContext(true), opened);
        const out = createBufferTarget();
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
        try {
            const code = await profileCheckMain(['open'], launcher);
            expect(code).toBe(2);
            expect(err.text()).toContain('--profile');
            expect(opened).toHaveLength(0);
        } finally {
            restore();
        }
    });

    test('open refuses a missing profile with a verdict and opens no browser (no fabrication)', async () => {
        const opened: unknown[] = [];
        const launcher: BrowserLauncher = {
            launch: async () => {
                opened.push(1);
                throw new Error('no browser may open for a missing profile');
            },
        };
        const out = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out });
        try {
            const code = await profileCheckMain(['open', '--profile', '/tmp/kk-xhs-open-absent'], launcher);
            expect(code).toBe(1);
            expect(opened).toHaveLength(0);
            const lines = out.text().trim().split('\n');
            const verdict = JSON.parse(lines[lines.length - 1] ?? '') as { status: string; detail: string };
            expect(verdict.status).toBe('refused');
            expect(verdict.detail).toContain('no profile at');
        } finally {
            restore();
        }
    });

    test('open navigates the supplied --url headed and records no automation-guard visit', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-xhs-open-'));
        const profileDir = join(dir, 'profile');
        const statePath = join(dir, 'guard-state.json');
        const { mkdirSync } = await import('node:fs');
        mkdirSync(profileDir, { recursive: true });
        const gotos: string[] = [];
        const requests: ProfileLaunchRequest[] = [];
        const openContext = {
            pages: () => [{ goto: async (url: string) => void gotos.push(url) }],
            once: (event: string, listener: () => void) => {
                if (event === 'close') listener();
            },
        };
        const launcher = fakeLauncher(openContext, requests);
        const guard = createAutomationGuard({ statePath, now: () => new Date('2026-09-28T10:00:00Z') });
        const out = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out });
        try {
            const code = await profileCheckMain(
                ['open', '--profile', profileDir, '--url', 'https://creator.xiaohongshu.com/publish/publish'],
                launcher,
                guard,
            );
            expect(code).toBe(0);
            expect(requests).toEqual([{ profileDir, headless: false }]);
            expect(gotos).toEqual(['https://creator.xiaohongshu.com/publish/publish']);
            const lines = out.text().trim().split('\n');
            const verdict = JSON.parse(lines[lines.length - 1] ?? '') as { status: string; detail: string };
            expect(verdict.status).toBe('verified');
            expect(verdict.detail).toContain('closed by the operator');
            // ADR-025: an open is neither a publish nor a check visit, so no guard state is written.
            expect(existsSync(statePath)).toBe(false);
        } finally {
            restore();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('task 0350 — layered capture, counter gate, reopen verify, podcast fields (R1-R4)', () => {
    const draftRun = async (state: Partial<FakeState>, over: Partial<Content> = {}) => {
        await seedImages();
        const { open, calls } = makeOpenPage({ ...happy, ...state });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent(over), options: { operation: '上传图文' } });
        return { result, log: calls[0] ?? [] };
    };

    const publicRun = async (state: Partial<FakeState>) => {
        await seedImages();
        const { open } = makeOpenPage({ ...happy, ...state });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        return t.publish({ content: cardContent({ publishStatus: 'public' }) });
    };

    const podcastRun = async (state: Partial<FakeState>, metaOver: Record<string, unknown> = {}) => {
        await seedMedia();
        const { open, calls } = makeOpenPage({ ...happy, ...state });
        const t = makeTransport('script', {
            openPage: open,
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({
            content: modeContent({ audio: { path: audio }, coverImage: cover, ...metaOver }),
            options: { operation: '发播客' },
        });
        return { result, log: calls[0] ?? [] };
    };

    test('R1: a captured -913x response aborts with AccountRiskControlError, not a save retry', async () => {
        const { result } = await draftRun({
            serverCapture: { source: 'xhr', text: 'HTTPBizError: {"code":-91301,"msg":"禁止发笔记，请遵守社区规范"}' },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('AccountRiskControlError');
        expect(result.error).toContain('not retryable');
    });

    test('R1: a captured platform biz error aborts with PublishError', async () => {
        const { result } = await draftRun({
            serverCapture: { source: 'fetch', text: 'HTTPBizError: {"code":-300,"msg":"操作频繁"}' },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('PublishError');
        expect(result.error).toContain('platform error');
    });

    test('R1: a captured ok response (note_id) lands in the Result metadata', async () => {
        const { result } = await draftRun({
            serverCapture: { source: 'xhr', text: '{"code":0,"success":true,"data":{"note_id":"abc123"}}' },
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.serverCapture).toEqual({ source: 'xhr', verdict: 'ok', code: '0', noteId: 'abc123' });
    });

    test('R1: a toast that only names a platform risk phrase aborts as AccountRiskControlError', async () => {
        const { result } = await draftRun({
            serverCapture: { source: 'toast', text: '审核未通过' },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('AccountRiskControlError');
        expect(result.error).toContain('not retryable');
    });

    test('R1: the read-only DOM probe keeps short risk leaves and ignores long nodes and ancestors', () => {
        const run = new Function('document', `return ${RISK_LEAVES_EXPR}`) as (document: unknown) => string;
        const node = (textContent: string, children: unknown[] = []) => ({ textContent, children });
        expect(
            JSON.parse(
                run({
                    querySelectorAll: () => [
                        node('x'.repeat(301)),
                        node('审核未通过', [{}]),
                        node(' 审核未通过 '),
                        node('ordinary text'),
                    ],
                }),
            ),
        ).toEqual(['审核未通过']);
    });

    test('R3: a collection name with a quote stays inside the probe string', () => {
        const name = "合集'; throw new Error('x')";
        const expr = collectionProbeExpr(name);
        const run = (innerText: string): string =>
            new Function('document', `return ${expr}`)({ body: { innerText } }) as string;
        expect(run(`prefix ${name} suffix`)).toBe('kk-verify-collection:yes');
        expect(run('other collection')).toBe('kk-verify-collection:no');
    });

    test('R1: the publish path aborts on a captured refusal even before the URL marker is checked', async () => {
        const result = await publicRun({
            serverCapture: { source: 'xhr', text: '{"code":-91301,"msg":"禁止发笔记"}' },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('AccountRiskControlError');
    });

    test('R2: a readable over-limit title counter throws TitleTooLongError before any save click', async () => {
        const { result, log } = await draftRun({ counterTitleOverride: '23/20' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('TitleTooLongError');
        expect(result.error).toContain('counter reads');
        // The image tab click is mode entry, not a save click; no save click may occur.
        expect(log.filter((entry) => entry.op === 'clickAt').length).toBe(1);
    });

    test('R2: a readable over-limit body counter throws ContentTooLongError', async () => {
        const { result } = await draftRun({ counterBodyOverride: '1001/1000' });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('ContentTooLongError');
    });

    test('R2: the body counter ignores a title counter when the body length-error is absent', () => {
        const read = (document: {
            querySelector: (sel: string) => { textContent: string; children: never[] } | null;
            querySelectorAll: (sel: string) => Array<{ textContent: string; children: never[] }>;
        }): string => {
            const previous = (globalThis as { document?: unknown }).document;
            (globalThis as { document?: unknown }).document = document;
            try {
                return (new Function(`return ${BODY_COUNTER_EXPR}`) as () => string)();
            } finally {
                (globalThis as { document?: unknown }).document = previous;
            }
        };
        const leaf = (text: string) => ({ textContent: text, children: [] as never[] });
        const documentFor = (input: { lengthError?: string; editLeaves?: string[]; titleLeaves?: string[] }) => ({
            querySelector(sel: string) {
                if (sel === 'div.edit-container div.length-error' && input.lengthError !== undefined) {
                    return leaf(input.lengthError);
                }
                return null;
            },
            querySelectorAll(sel: string) {
                const edit = (input.editLeaves ?? []).map(leaf);
                const title = (input.titleLeaves ?? []).map(leaf);
                if (sel === 'div.edit-container *') return edit;
                if (sel === 'div.title-container *') return title;
                if (sel.includes('div.edit-container') && sel.includes('div.title-container'))
                    return [...edit, ...title];
                return [];
            },
        });
        expect(read(documentFor({ lengthError: '1001/1000', titleLeaves: ['5/20'] }))).toBe('1001/1000');
        expect(read(documentFor({ editLeaves: ['3/1000'], titleLeaves: ['5/20'] }))).toBe('3/1000');
        expect(read(documentFor({ titleLeaves: ['5/20'] }))).toBe('kk-counter-none');
    });

    test('R3: the reopen body probe ignores a title counter', () => {
        const previous = (globalThis as { document?: unknown }).document;
        (globalThis as { document?: unknown }).document = {
            querySelector: () => null,
            querySelectorAll: (sel: string) =>
                sel === 'div.title-container *' || sel.includes('div.title-container')
                    ? [{ textContent: '5/20', children: [] as never[] }]
                    : [],
        };
        try {
            const read = (new Function(`return ${VERIFY_BODY_EXPR}`) as () => string)();
            expect(read).toBe(JSON.stringify({ textLen: 0 }));
        } finally {
            (globalThis as { document?: unknown }).document = previous;
        }
    });

    test('R2: a counter that does not read N/M is ignored, not fatal', async () => {
        const { result } = await draftRun({ counterTitleOverride: '无法读取' });
        expect(result.ok).toBe(true);
    });

    test('R3: a draft whose reopened slots disagree fails verification by name', async () => {
        const { result } = await draftRun({ verifySlotCount: 1 });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('DraftVerifyError');
        expect(result.error).toContain('expected 2 thumbnails');
    });

    test('R3: blob-only thumbnails on the reopened draft fail verification when the wire was silent', async () => {
        // uploadNeverStarts scripts a console that never uploaded; the pre-save gate passes on
        // srcs alone, so the reopen must still reject local srcs — the server copy may be missing.
        const { result } = await draftRun({ verifyLocalSrcs: true, uploadNeverStarts: true });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('non-https');
    });

    test('R3: blob srcs on the reopened draft pass when the wire completed every upload', async () => {
        // Measured 2026-11-11: the reopened editor re-hosts its CDN images as blob: URLs after the
        // wire finished all uploads — blob srcs there are presentation, not missing persistence.
        const { result } = await draftRun({ verifyLocalSrcs: true });
        expect(result.ok).toBe(true);
    });

    test('R3: a reopened editor that never renders content fails verification', async () => {
        // TipTap hydrates after the route lands; if it never answers within the step window the
        // verify must fail by name instead of judging the blank editor as an empty draft.
        const { result } = await draftRun({ verifyEditorBlank: true });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('never rendered content');
    });

    test('R3: a reopened editor recovers when its first DOM probes detach', async () => {
        await seedImages();
        const { page } = makeFakePage({ ...happy });
        const probes = new Set(['/* kk-verify-slots */', '/* kk-verify-title */', '/* kk-verify-body */']);
        const t = makeTransport('script', {
            openPage: async () => ({
                close: async () => {},
                page: {
                    ...page,
                    evaluate: async (expression) => {
                        if (probes.delete(`${expression.split(' */', 1)[0]} */`)) {
                            throw new Error('reopened editor detached');
                        }
                        return page.evaluate(expression);
                    },
                },
            }),
            stepTimeoutMs: 1_000,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent(), options: { operation: '上传图文' } });
        expect(probes.size).toBe(0);
        expect(result.ok).toBe(true);
    });

    test('R3: verify reopen navigation falls back to locator clicks when box reads fail', async () => {
        // A driver whose boundingBoxesOnScreen rejects (or returns nothing) for the draft-box
        // selectors must still reopen via the plain locator path — coordinate clicks are only an
        // overlay-proof optimization, not a hard dependency.
        await seedImages();
        const state: FakeState = { ...happy };
        const fake = makeFakePage(state);
        const page: XhsPage = {
            ...fake.page,
            boundingBoxesOnScreen: async (selector: string) =>
                selector === 'text=上传图文'
                    ? [{ x: 100, y: 200, width: 80, height: 30 }]
                    : Promise.reject(new Error('box read failed')),
        };
        const t = makeTransport('script', {
            openPage: async () => ({ page, close: async () => {} }),
            stepTimeoutMs: 400,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent(), options: { operation: '上传图文' } });
        expect(result.ok).toBe(true);
    });

    test('R3: a title that did not persist fails verification', async () => {
        const { result } = await draftRun({ verifyTitleMismatch: true });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('title mismatch');
    });

    test('R3: an empty reopened body fails verification', async () => {
        const { result } = await draftRun({ verifyBodyEmpty: true });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('neither');
    });

    test('R3: a missing collection membership on the podcast draft fails verification', async () => {
        const { result } = await podcastRun({ verifyCollectionMissing: true });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('collection');
    });

    test('R3: a missing draft box entry fails verification loudly', async () => {
        const { result } = await draftRun({ draftNavMissing: true });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('could not reopen');
    });

    test('R3: a draft list without an 编辑 control fails verification loudly', async () => {
        const { result } = await draftRun({ draftEditMissing: true });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('shows no');
    });

    test('R4: the podcast note titles the editor, derives a bounded body, and joins the 合集', async () => {
        const { result, log } = await podcastRun({});
        expect(result.ok).toBe(true);
        const fills = log.filter((entry) => entry.op === 'fill' && String(entry.args[0]).includes('input.d-text'));
        expect(fills.length).toBeGreaterThan(0);
        expect(fills[0]?.args[1]).toBe('模式标题');
        const types = log.filter((entry) => entry.op === 'type');
        expect((types[0]?.args[1] as string | undefined)?.length).toBeLessThanOrEqual(1000);
        const chip = log.filter((entry) => entry.op === 'click' && String(entry.args[0]).includes('加入播客合集'));
        expect(chip.length).toBeGreaterThan(0);
        expect((result.metadata?.draftVerified as Record<string, unknown>)?.collection).toBe('咸话咸说之每日AI乱炖');
    });

    test('R4: a custom 合集 in content metadata wins over the default show collection', async () => {
        const { result } = await podcastRun({}, { collection: '我的合集' });
        expect(result.ok).toBe(true);
        expect((result.metadata?.draftVerified as Record<string, unknown>)?.collection).toBe('我的合集');
    });

    test('R4: derivePodcastBody caps the raw article at the body limit and keeps intro/closing', () => {
        const article = ['开头段']
            .concat(
                Array.from({ length: 40 }, (_, i) => `## 标题${i} 一些正文内容放在这里`),
                ['结尾段'],
            )
            .join('\n');
        const out = derivePodcastBody({ title: 'T', body: article, format: 'markdown' } as Content);
        expect(out.length).toBeLessThanOrEqual(1000);
        expect(out.startsWith('开头段')).toBe(true);
        expect(out.endsWith('结尾段')).toBe(true);
    });

    test('R4: derivePodcastBody drops headlines first when the budget runs out', () => {
        const out = derivePodcastBody({
            title: 'T',
            body: `开头\n${Array.from({ length: 200 }, (_, i) => `## 很长的标题${i}`).join('\n')}`,
            format: 'markdown',
        } as Content);
        expect(out.length).toBeLessThanOrEqual(1000);
    });

    test('R4: an empty body derives from the title', () => {
        const out = derivePodcastBody({ title: '只有标题', body: '', format: 'markdown' } as Content);
        expect(out).toBe('只有标题');
    });
});
