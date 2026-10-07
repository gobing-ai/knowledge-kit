import { afterAll, beforeEach, describe, expect, setSystemTime, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';
import { type BrowserLauncher, BrowserProfileMissingError, LoginTimeoutError } from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import { type AutomationGuard, CAP_WINDOW_MS, createAutomationGuard } from '../src/automation-guard';
import {
    CREATOR_TAB_COUNT,
    clickCreatorTab,
    createShadowProbe,
    defaultLauncher,
    getPublishTransport,
    main,
    makeDefaultOpenPage,
    type OpenPage,
    type ProfileSessionCheck,
    processPublishIO,
    validatePublishInput,
    wrapPlaywrightPage,
    XhsBrowserTransport,
    type XhsLocator,
    type XhsOperation,
    type XhsPage,
} from '../src/index';
import { findAttachedSelector, findSelector } from '../src/page';
import { checkProfileSession, loginProfile, main as profileCheckMain } from '../src/profile-check';

// ADR-025: publish runs a 2h-capped automation guard and a headless session preflight, and the
// CLI `check` command uses the same guard. Both are real side effects, so:
//  - `makeTransport` stubs them for the flow tests (a default preflight would open a browser);
//  - the guard's state file is redirected to a temp path cleared before every test, so the caps
//    never leak between tests or write into the operator's ~/.config/kk.
const AUTOMATION_STATE = join(mkdtempSync(join(tmpdir(), 'kk-xhs-guard-')), 'state.json');
process.env.KK_XHS_AUTOMATION_STATE = AUTOMATION_STATE;

beforeEach(() => {
    rmSync(AUTOMATION_STATE, { force: true });
});

/** The allow-all guard for tests that are not exercising the cap itself. */
const ALLOW_ALL: AutomationGuard = { allow: () => ({ allowed: true, reason: '' }), record: () => undefined };

/** A `verified` preflight: tests not exercising the preflight must never open a browser. */
const VERIFIED_PREFLIGHT = async (profileDir: string): Promise<ProfileSessionCheck> => ({
    status: 'verified',
    profileDir,
    detail: 'test stub',
});

/**
 * ADR-025: the publish path is guarded, so every construction goes through here and stubs both
 * seams. A test that wants the real guard or preflight passes them explicitly.
 */
function makeTransport(
    driver: 'script' | 'agent' = 'script',
    opts: ConstructorParameters<typeof XhsBrowserTransport>[1] = {},
): XhsBrowserTransport {
    return new XhsBrowserTransport(driver, { automation: ALLOW_ALL, preflight: VERIFIED_PREFLIGHT, ...opts });
}

const tmpRoot = join(process.cwd(), '.tmp-test-xhs');
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
    /** The modal keeps covering the bar until `去发布` is clicked (the draft-refusal case). */
    podcastNeedsAdvance: boolean;
    podcastAudioAttached: boolean;
    podcastCoverAttached: boolean;
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
        if (isDraftBox(selector)) return counterAttached();
        if (isTextProbe(selector)) return toastFound(selector);
        if (isModal(selector)) return state.podcastModal;
        return true;
    };
    /** The upload inputs sit behind styled drop zones: attached but never "visible". */
    const isVisible = (selector: string): boolean => attached(selector) && !isFileInput(selector);
    /** The editor only holds something to persist once content registered in it. */
    const savableContent = () =>
        bodyTyped || state.articlePasted || (state.podcastAudioAttached && state.podcastCoverAttached);
    /**
     * What a click on a draft control does. `暂存离开` dismisses the editor whether or not the save
     * registers, which is what makes the counter/stamp delta the only usable signal.
     */
    const applySaveClick = (label: string) => {
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
                    fill: async (text) => {
                        calls.push({ op: 'fill', args: [selector, text] });
                    },
                    click: async () => {
                        calls.push({ op: 'click', args: [selector] });
                        // Light-DOM controls: the article editor, the podcast modal, `一键排版`,
                        // and 写长文's own `暂存离开` (which is NOT in the shadow bar).
                        const draftLabel = [...DRAFT_LABELS].find((label) => selector.includes(label));
                        if (draftLabel !== undefined) applySaveClick(draftLabel);
                        if (selector.includes('新的创作')) state.articleOpen = true;
                        if (selector.includes('上传音频')) state.podcastModal = true;
                        if (selector.includes('去发布')) state.podcastModal = false;
                    },
                    type: async (text) => {
                        calls.push({ op: 'type', args: [selector, text] });
                        // TipTap only registers typed content in this model.
                        if (selector.includes('tiptap')) bodyTyped = true;
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
            // The modal is a picker: with both artifacts attached the platform moves on by itself,
            // unless this console only advances on `去发布` (see `podcastNeedsAdvance`).
            if (state.podcastModal && state.podcastAudioAttached && state.podcastCoverAttached) {
                if (!state.podcastNeedsAdvance) state.podcastModal = false;
            }
        },
        evaluate: async (expression) => {
            calls.push({ op: 'evaluate', args: [] });
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
    };
    return { page, calls };
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
    podcastNeedsAdvance: false,
    podcastAudioAttached: false,
    podcastCoverAttached: false,
};

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
        // R1: the console opens on the video tab, so the image tab is entered before any upload.
        expect(ops.indexOf('clickInViewport')).toBeGreaterThan(ops.indexOf('goto'));
        expect(ops.indexOf('clickInViewport')).toBeLessThan(ops.indexOf('setInputFiles'));
        // R2: the note body is the TipTap editor (Quill was replaced in 2026-09), and it must be
        // TYPED — a synthetic value set leaves nothing for the save to persist.
        const typed = log.filter((entry) => entry.op === 'type').map((entry) => String(entry.args[0]));
        expect(typed).toContain('div.tiptap[contenteditable="true"]');
        const filled = log.filter((entry) => entry.op === 'fill').map((entry) => String(entry.args[0]));
        expect(filled).not.toContain('div.tiptap[contenteditable="true"]');
        // R3: previews are counted through XHS's own `preivew` class, and the image input is
        // the .jpg one (the video input has no accept list match).
        const selectors = log.filter((entry) => entry.op === 'locator').map((entry) => String(entry.args[0]));
        expect(selectors).toContain('img.preivew-image');
        expect(selectors).toContain('input[type="file"][accept*=".jpg"]');
        // R4: the submit control is resolved by label inside the closed shadow bar.
        const shadow = log.find((entry) => entry.op === 'findShadowControl');
        expect(shadow?.args[0]).toEqual(['暂存离开', '存草稿', '保存草稿']);
        expect(ops).toContain('clickAt');
    });

    test('no CDP shadow access fails loud instead of clicking a guessed coordinate', async () => {
        await seedImages();
        const fake = makeFakePage({ ...happy });
        const pageWithoutShadow: XhsPage = { ...fake.page, findShadowControl: undefined, clickAt: undefined };
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
            page: { ...fake.page, clickInViewport: async () => false },
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
        expect(result.error).toContain('in-viewport');
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
        expect(result.error).toContain('login timeout');
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
        // Exactly one submit click: a retry could publish twice.
        expect(log.filter((entry) => entry.op === 'clickAt')).toHaveLength(1);
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

describe('xhs-pub headless profile-session check (0177, read-only)', () => {
    test('verified: reopens the profile headless, read-only, and closes the context', async () => {
        const closed: string[] = [];
        const requests: Array<{ profileDir: string; headless: boolean }> = [];
        const launcher = fakeLauncher(consoleContext(true, closed), requests);
        const outcome = await checkProfileSession({ profileDir: '/tmp/kk-xhs-check', timeoutMs: 500, launcher });
        expect(outcome.status).toBe('verified');
        expect(outcome.detail).toContain('authenticated');
        expect(requests).toEqual([{ profileDir: '/tmp/kk-xhs-check', headless: true }]);
        expect(closed).toEqual(['closed']);
    });

    test('refused: headless and headed refusals (no authenticated console) are an explicit failure', async () => {
        const closed: string[] = [];
        const launcher = fakeLauncher(consoleContext(false, closed));
        const outcome = await checkProfileSession({ profileDir: '/tmp/kk-xhs-check', timeoutMs: 60, launcher });
        expect(outcome.status).toBe('refused');
        expect(outcome.detail).toContain('readiness refused');
        expect(closed).toEqual(['closed', 'closed']);
    });

    test('refused: a missing profile headless never fabricates a session', async () => {
        const launcher: BrowserLauncher = {
            launch: async () => {
                throw new BrowserProfileMissingError('/tmp/kk-xhs-absent');
            },
        };
        const outcome = await checkProfileSession({ profileDir: '/tmp/kk-xhs-absent', timeoutMs: 60, launcher });
        expect(outcome.status).toBe('refused');
        expect(outcome.detail).toContain('/tmp/kk-xhs-absent');
    });

    test('loginProfile: headed recovery resolves once authenticated and closes the context', async () => {
        const closed: string[] = [];
        const requests: Array<{ profileDir: string; headless: boolean }> = [];
        const launcher = fakeLauncher(consoleContext(true, closed), requests);
        await loginProfile({ profileDir: '/tmp/kk-xhs-login', timeoutMs: 500, launcher });
        expect(requests).toEqual([{ profileDir: '/tmp/kk-xhs-login', headless: false }]);
        expect(closed).toEqual(['closed']);
    });

    test('loginProfile: expired session times out with the context closed', async () => {
        const closed: string[] = [];
        const launcher = fakeLauncher(consoleContext(false, closed));
        await expect(loginProfile({ profileDir: '/tmp/kk-xhs-login', timeoutMs: 60, launcher })).rejects.toBeInstanceOf(
            LoginTimeoutError,
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
                ['check', '--profile', '/tmp/kk-xhs-check', '--timeout', '50'],
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
                ['check', '--profile', '/tmp/kk-xhs-check', '--timeout', '50'],
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
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: err });
        try {
            expect(await profileCheckMain(['nonsense'], fakeLauncher(consoleContext(true)))).toBe(2);
            expect(err.text()).toContain('usage');
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
                const code = await profileCheckMain(['check', '--profile', '/tmp/kk-xhs-budget'], spentLauncher, guard);
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
    const verified = async (profileDir: string): Promise<ProfileSessionCheck> => ({
        status: 'verified',
        profileDir,
        detail: 'stub',
    });
    const refused = async (profileDir: string): Promise<ProfileSessionCheck> => ({
        status: 'refused',
        profileDir,
        detail: 'no authenticated console in the saved profile',
    });

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
            // The page is never reached: the budget is consumed at the headed launch, and this
            // openPage proves it by throwing if it is ever called.
            const never = async () => {
                throw new Error('openPage must not be reached');
            };
            const first = makeTransport('script', { automation: guard, preflight: verified, openPage: never });
            const firstResult = await first.publish({ content: cardContent() });
            expect(firstResult.ok).toBe(false);

            const second = makeTransport('script', { automation: guard, preflight: verified, openPage: never });
            const secondResult = await second.publish({ content: cardContent() });
            expect(secondResult.ok).toBe(false);
            expect(secondResult.error).toContain('automation cap');
            expect(secondResult.error).toContain("'publish' already ran");
        });
    });

    test('preflight: a refused session blocks the headed visit and leaves the budget intact', async () => {
        await seedImages();
        await withGuardDir(async (dir) => {
            const guard = createAutomationGuard({ statePath: join(dir, 'state.json'), now: NOW });
            let opened = 0;
            const transport = makeTransport('script', {
                automation: guard,
                preflight: refused,
                openPage: async () => {
                    opened += 1;
                    throw new Error('unreachable');
                },
            });
            const result = await transport.publish({ content: cardContent() });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('session preflight refused');
            expect(result.error).toContain('no authenticated console');
            expect(opened).toBe(0);
            // The operator can log in and retry the same day: the cap bounds headed visits, not attempts.
            expect(guard.allow('publish').allowed).toBe(true);
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
                preflight: verified,
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
                    ['check', '--profile', '/tmp/kk-xhs-check', '--timeout', '50'],
                    fakeLauncher(consoleContext(true)),
                    guard,
                );
                expect(first).toBe(0);
                const second = await profileCheckMain(
                    ['check', '--profile', '/tmp/kk-xhs-check', '--timeout', '50'],
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
    /** A refused preflight witness: reaching it is provable, because its wording is unique. */
    const REFUSED_PREFLIGHT = async (profileDir: string): Promise<ProfileSessionCheck> => ({
        status: 'refused',
        profileDir,
        detail: 'preflight witness',
    });

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
        log.filter((entry) => entry.op === 'click' && String(entry.args[0]) === 'button:has-text("发布")').length;

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
        const t = makeTransport('script', { openPage: open, preflight: REFUSED_PREFLIGHT });
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
        const entered = (calls[0] ?? []).filter((entry) => entry.op === 'clickInViewport');
        expect(entered[0]?.args[0]).toBe('div.creator-tab:has-text("上传图文")');
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
            // Mode entry waits for the tab bar to mount BEFORE clicking an on-screen tab.
            expect(ops.indexOf('countOnScreen')).toBeGreaterThan(-1);
            expect(ops.indexOf('countOnScreen')).toBeLessThan(ops.indexOf('clickInViewport'));
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
            const t = makeTransport('script', { openPage: open, preflight: REFUSED_PREFLIGHT });
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
            const t = makeTransport('script', { openPage: open, preflight: REFUSED_PREFLIGHT });
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
        const t = makeTransport('script', { openPage: open, preflight: REFUSED_PREFLIGHT });
        const result = await t.publish({ content: cardContent({}, 19) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('≤18');
        expect(calls).toHaveLength(0);
        expect(closed).toHaveLength(0);
    });

    test('上传图文: an over-limit body (1000) fails before any launch', async () => {
        const { open, closed } = makeOpenPage(happy);
        const t = makeTransport('script', { openPage: open, preflight: REFUSED_PREFLIGHT });
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
        const t = makeTransport('script', { openPage: open, preflight: REFUSED_PREFLIGHT });
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
        expect(article.log.filter((entry) => entry.op === 'clickAt')).toEqual([]);

        const imageText = await run(IMAGE_TEXT_CASE);
        expect(imageText.result.metadata?.draftPath).toBe('shadow');
        expect(imageText.result.metadata?.draftClick).toBe('606,855');
    });

    test('发播客: the modal takes audio AND cover, then the draft saves once the platform advances', async () => {
        const { result, log } = await run(PODCAST_CASE);
        expect(result.ok).toBe(true);
        expect(result.metadata?.artifactPaths).toEqual([audio, cover]);
        const uploads = log.filter((entry) => entry.op === 'setInputFiles').map((entry) => String(entry.args[0]));
        expect(uploads).toHaveLength(2);
        expect(uploads[0]).toContain('.mp3');
        expect(uploads[1]).toContain('.jpg');
        // The RSS path is excluded by decision: no audio-card upload, no feed subscription.
        expect(log.some((entry) => entry.op === 'click' && String(entry.args[0]).includes('添加RSS订阅'))).toBe(false);
        expect(publishTouches(log)).toEqual([]);
    });

    test('发播客: a draft run refuses the publish-adjacent 去发布 advance and fails naming it', async () => {
        const { result, log } = await run(PODCAST_CASE, {
            state: { podcastNeedsAdvance: true },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('去发布');
        expect(result.error).toContain('publish-adjacent');
        // The rail held: the modal's advance control was never clicked on a draft run.
        const clicked = log.filter((entry) => entry.op === 'click').map((entry) => String(entry.args[0]));
        expect(clicked.some((selector) => selector.includes('去发布'))).toBe(false);
        expect(publishTouches(log)).toEqual([]);
    });

    test('发播客: an explicit public request may use the modal advance before publishing', async () => {
        const { result } = await run(PODCAST_CASE, {
            state: { podcastNeedsAdvance: true },
            content: modeContent({ audio: { path: audio }, coverImage: cover, publishStatus: 'public' }),
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
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
