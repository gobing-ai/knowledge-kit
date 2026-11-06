import type { Content, Result } from '@gobing-ai/kk-core';
import { ResultSchema } from '@gobing-ai/kk-core';
import { trySelectors } from '@gobing-ai/publish-harness';
import {
    expectOutcome,
    markdownToHtml,
    pasteHtml,
    readScopedSignal,
    uploadFile,
} from '@gobing-ai/publish-harness/browser';
import type { Page } from 'playwright';
import { artifactPaths, type ModeInput, PUBLISH_URL, PUBLISHED_MARKER, TARGET, type XhsOperation } from './modes';
import { clickCreatorTab, findAttachedSelector, findSelector, POLL_MS, waitUntil, type XhsPage } from './page';

/**
 * The four xhs flows (ADR-029: the operations own their flow, selector table and success signal)
 * plus the rails they share — mode entry, the scoped signal probe, the 暂存离开 click and publish.
 *
 * `docs/design/xhs-ui-discovery.md` is the evidence for every selector here; where the recorded
 * evidence does not cover a detail the code says so rather than inventing one.
 */

const NOTE_TITLE = [
    'input.d-text[placeholder="填写标题会有更多赞哦"]',
    'input[placeholder*="标题"]',
    '#title-textarea input',
];
// The note body is TipTap ProseMirror since 2026-09 (it was Quill `.ql-editor`).
const NOTE_BODY = [
    'div.tiptap[contenteditable="true"]',
    'div[contenteditable="true"].ql-editor',
    '#post-textarea',
    '.ql-editor',
];
// Uploaded previews carry XHS's own class spelling (`preivew`, not `preview`).
const NOTE_THUMBNAIL = ['img.preivew-image', '.img-preview img'];
// The image input is distinguishable from the video input by its accept list (`.jpg` first).
const IMAGE_FILE_INPUT = [
    'input[type="file"][accept*=".jpg"]',
    'input[type="file"].upload-input',
    'input[type="file"]',
];
const VIDEO_FILE_INPUT = ['input[type="file"][accept*=".mp4"]', 'input[type="file"].upload-input'];
const VIDEO_EDITOR = ['div.tiptap.ProseMirror', 'div.tiptap[contenteditable="true"]', '.ProseMirror'];

// 写长文: the landing offers 新的创作 (author in place) and 导入链接 (excluded — it is fed from a
// 公众号 source, which would put another platform's publishing and censorship in the critical
// path), then an in-page ProseMirror editor with 暂存离开 and 一键排版.
const ARTICLE_NEW = ['text=新的创作', 'button:has-text("新的创作")'];
const ARTICLE_EDITOR = ['div.tiptap.ProseMirror.ProseMirror-focused', 'div.tiptap.ProseMirror', '.ProseMirror'];
// The clickable `一键排版` is the button (measured: `button.d-button…` at the editor's action bar);
// the `ailayout-*` divs are its label wrappers.
const ARTICLE_LAYOUT = ['button:has-text("一键排版")', 'div.ailayout-btn_wrp', 'div.ailayout-btn_label'];

// 发播客: 上传音频 opens a modal carrying the audio picker AND the cover picker; the two inputs
// are told apart by their accept lists.
const PODCAST_OPEN = ['text=上传音频', 'button:has-text("上传音频")'];
const PODCAST_MODAL = ['div.creator-modal-sty', '.d-modal.d-modal-centered', '.d-modal'];
const PODCAST_AUDIO_INPUT = ['input[type="file"][accept*=".mp3"]', 'input[type="file"][accept*=".wav"]'];
const PODCAST_MODAL_ADVANCE = ['去发布'];
/* Measured post-attach flow (2026-11-06 headless probe, 10-min mp3 + 1:1 png): a raw
 * input.files assignment registers the AUDIO (`上传成功` appears) but the COVER card never
 * advances and `去发布` stays `disabled` — only clicking the cover card and handing the file to
 * the native file chooser the site opens takes both. `去发布` is then just the ADVANCE control: the
 * next page is the full podcast editor carrying the closed-shadow bar (`暂存离开`@left, `发布`@right),
 * so a draft run may click it too — it does not publish on its own. */
const PODCAST_COVER_ZONE = '.d-modal div:has-text("设置封面")';
const PODCAST_UPLOAD_ACK = '上传成功';

/**
 * The `暂存离开` labels, newest first: XHS renamed the control, and the older labels stay as
 * fallbacks. The control is a `BUTTON.ce-btn.white` inside the publish bar.
 */
const DRAFT_LABELS = ['暂存离开', '存草稿', '保存草稿'];
const PUBLISH_LABELS = ['发布'];
/** The console's publish confirmation text, read as a scoped signal (the URL marker is primary). */
const PUBLISH_CONFIRM = ['发布成功', '已发布'];
/** The draft toast measured on save (`保存成功`); read only from notification containers. */
const DRAFT_TOASTS = ['保存成功'];

/** The submit bar is the custom element `<XHS-PUBLISH-BTN>`, whose shadow root is CLOSED. */
const SHADOW_BAR = 'the xhs publish bar (closed shadow root)';

/**
 * Where each mode's action-bar controls (`暂存离开` and `发布`) live, in the order the flow tries it.
 *
 * Measured (discovery §3): the 图文 action bar is the closed-shadow `<XHS-PUBLISH-BTN>` — a
 * light-DOM search over every open shadow root finds **zero** matches, so a text selector there
 * could only ever hit a mirrored clone. The same labels ARE in the light DOM in 写长文, which is why
 * that mode tries the normal locator first and keeps the CDP path as the fallback; the three bar
 * modes go straight to CDP, where the label and box are read rather than guessed.
 */
const MODE_ACTION_PATHS: Record<XhsOperation, readonly ActionPath[]> = {
    上传图文: ['shadow'],
    上传视频: ['shadow'],
    写长文: ['light', 'shadow'],
    发播客: ['shadow'],
};

type ActionPath = 'shadow' | 'light';

/** Everything the flows need besides the validated mode input. */
export interface ModeRunDeps {
    page: XhsPage;
    content: Content;
    publishStatus: 'draft' | 'public';
    profileDir: string;
    driver: string;
    stepTimeoutMs: number;
    submitSettleMs: number;
    submitAttempts: number;
    /** Draft evidence captured before the mode was entered (the counter only exists on the landing view). */
    draftBaseline: DraftBaseline;
}

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The shared helpers are declared against Playwright's `Page`, while the flows drive the
 * structural `XhsPage` seam (which is what lets the offline tests script the console). Every
 * member those helpers touch — `locator`, `evaluate`, `setInputFiles` — is implemented by
 * `wrapPlaywrightPage`, so this is a type-level bridge over the same object, not a second page.
 */
function asPlaywrightPage(page: XhsPage): Page {
    return page as unknown as Page;
}

/** Enter a console mode: the tab bar must be mounted, then the ON-SCREEN tab is clicked. */
async function enterMode(deps: ModeRunDeps, label: string): Promise<void> {
    await clickCreatorTab(deps.page, label, { timeoutMs: deps.stepTimeoutMs });
}

/**
 * Click a labelled control inside the CLOSED shadow publish bar. The label and box come from CDP,
 * so the click is aimed at a read target rather than a guessed coordinate; a driver without that
 * capability fails loud instead of clicking blind.
 */
async function clickShadowControl(
    page: XhsPage,
    labels: readonly string[],
): Promise<{ ok: true; label: string; x: number; y: number } | { ok: false; error: string }> {
    if (!page.findShadowControl || !page.clickAt) {
        return {
            ok: false,
            error: `submit control: ${SHADOW_BAR} and this driver has no CDP access to resolve it`,
        };
    }
    const control = await page.findShadowControl(labels);
    if (!control) {
        return {
            ok: false,
            error: `submit control: none of [${labels.join(', ')}] found in ${SHADOW_BAR}`,
        };
    }
    await page.clickAt(control.x, control.y);
    return { ok: true, label: control.label, x: control.x, y: control.y };
}

/** Click a labelled control that lives in the light DOM (写长文's action bar). */
async function clickLightControl(
    page: XhsPage,
    labels: readonly string[],
    timeoutMs: number,
    what: string,
): Promise<{ ok: true; label: string; selector: string } | { ok: false; error: string }> {
    const candidates = labels.flatMap((label) => [`button:has-text("${label}")`, `text=${label}`]);
    let selector: string;
    try {
        selector = await findSelector(
            page,
            candidates,
            `${what} (light DOM) none of [${labels.join(', ')}]`,
            timeoutMs,
        );
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const label = labels.find((candidate) => selector.includes(candidate)) ?? labels[0];
    // No `force`: the actionability check is what keeps a covered or detached control from being
    // clicked, and the site signal afterwards is what decides whether the click did anything.
    await page.locator(selector).first().click({ timeout: timeoutMs });
    return { ok: true, label: label ?? '', selector };
}

interface ActionClick {
    ok: true;
    path: ActionPath;
    label: string;
    /** Coordinates for the shadow path, the resolved selector for the light path. */
    click: string;
}

/** Click an action-bar control of this mode, on the path its evidence says that bar lives on. */
async function clickActionControl(
    operation: XhsOperation,
    deps: ModeRunDeps,
    labels: readonly string[],
    what: string,
): Promise<ActionClick | { ok: false; error: string }> {
    let lastError = '';
    for (const path of MODE_ACTION_PATHS[operation]) {
        if (path === 'shadow') {
            const clicked = await clickShadowControl(deps.page, labels);
            if (clicked.ok) return { ok: true, path, label: clicked.label, click: `${clicked.x},${clicked.y}` };
            lastError = clicked.error;
            continue;
        }
        const clicked = await clickLightControl(deps.page, labels, deps.stepTimeoutMs, what);
        if (clicked.ok) return { ok: true, path, label: clicked.label, click: `selector:${clicked.selector}` };
        lastError = clicked.error;
    }
    return { ok: false, error: lastError };
}

/** Draft evidence captured before the editor opens (the counter only exists on that view). */
export interface DraftBaseline {
    count: number | null;
    stamps: string[];
}

/**
 * Read the console's draft counter (`草稿箱(N)`). It exists only on the landing view: the image
 * editor replaces the header, so this must be read before entering the mode. Returns null when the
 * label carries no number yet.
 */
async function readDraftCount(page: XhsPage): Promise<number | null> {
    for (const selector of ['text=/草稿箱\\(\\d+\\)/', 'text=草稿箱']) {
        // Attachment, not visibility: the label lives in a panel that may be collapsed.
        const attached = await page
            .locator(selector)
            .count()
            .catch(() => 0);
        if (attached === 0) continue;
        const locator = page.locator(selector).first();
        if (!locator.textContent) continue;
        const text = await locator.textContent().catch(() => '');
        const match = /草稿箱\s*[（(]\s*(\d+)\s*[）)]/.exec(text);
        if (match?.[1] !== undefined) return Number(match[1]);
    }
    return null;
}

/**
 * Timestamps the console prints for a saved draft, e.g. `保存于2026-09-25 21:37`. The current and
 * previous two minutes are accepted so a save near a minute boundary still confirms.
 */
function draftSavedStamps(now = new Date()): string[] {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [0, 1, 2].map((minutesAgo) => {
        const stamp = new Date(now.getTime() - minutesAgo * 60_000);
        return `保存于${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
    });
}

/** Which candidate save stamps are already on the page — the baseline a later check diffs against. */
async function readDraftStamps(page: XhsPage): Promise<string[]> {
    const present: string[] = [];
    for (const stamp of draftSavedStamps()) {
        const attached = await page
            .locator(`text=${stamp}`)
            .count()
            .catch(() => 0);
        if (attached > 0) present.push(stamp);
    }
    return present;
}

/** Draft evidence captured before the mode is entered (the counter only exists on the landing view). */
export async function readDraftBaseline(page: XhsPage): Promise<DraftBaseline> {
    return { count: await readDraftCount(page), stamps: await readDraftStamps(page) };
}

/**
 * A draft counts as observed only from a DELTA against the pre-entry baseline: the console's draft
 * counter moved, or a save timestamp appeared that was not already there. A readable counter with
 * no usable baseline is NOT evidence — XHS autosaves uploads, so "the counter exists" says nothing
 * about this save.
 */
async function isDraftRowSaved(page: XhsPage, baseline: DraftBaseline): Promise<boolean> {
    const stamps = await readDraftStamps(page);
    if (stamps.some((stamp) => !baseline.stamps.includes(stamp))) return true;
    const after = await readDraftCount(page);
    if (baseline.count === null || after === null) return false;
    return after > baseline.count;
}

/**
 * The observed draft signal, or null (rail: success only from a signal the site actually showed).
 *
 * The URL does not change on save (measured: `保存成功` + `草稿箱(N)` with the URL untouched), so
 * the signals are the toast and the counter/timestamp delta. The toast is read through
 * `readScopedSignal`, scoped to the page's notification containers — never an unscoped
 * `:text(...)`, which the note body this flow just pasted would satisfy.
 */
async function draftSignalEvidence(page: XhsPage, baseline: DraftBaseline): Promise<string | null> {
    const toast = await readScopedSignal(asPlaywrightPage(page), DRAFT_TOASTS);
    if (toast !== null) return `toast:${toast}`;
    if (await isDraftRowSaved(page, baseline)) return 'draft-row';
    return null;
}

async function applyNoteTitle(deps: ModeRunDeps): Promise<void> {
    const selector = await findSelector(deps.page, NOTE_TITLE, 'title input', deps.stepTimeoutMs);
    await deps.page
        .locator(selector)
        .first()
        .fill(deps.content.title ?? '');
}

async function typeNoteBody(deps: ModeRunDeps, selectors: readonly string[], what: string): Promise<void> {
    const selector = await findSelector(deps.page, selectors, what, deps.stepTimeoutMs);
    const body = deps.page.locator(selector).first();
    const text = deps.content.body ?? '';
    // Type rather than fill: TipTap ignores a synthetic value set, so a filled body leaves the
    // note unsaved and the draft never becomes observable.
    if (typeof body.type === 'function') {
        await body.click();
        await body.type(text, { delay: 5 });
        return;
    }
    await body.fill(text);
}

/** The uploaded-preview count must match the payload: it is how a wrong input is caught. */
async function confirmThumbnails(deps: ModeRunDeps, expected: number): Promise<void> {
    const selector = await findSelector(deps.page, NOTE_THUMBNAIL, 'thumbnail wait', deps.stepTimeoutMs);
    const matches = await waitUntil(
        () =>
            deps.page
                .locator(selector)
                .count()
                .then((count) => count >= expected),
        deps.stepTimeoutMs,
    );
    const observed = await deps.page.locator(selector).count();
    if (!matches || observed !== expected) {
        throw new Error(`thumbnail count: expected ${expected}, observed ${observed}`);
    }
}

async function composeImageText(input: { operation: '上传图文'; images: string[] }, deps: ModeRunDeps): Promise<void> {
    await enterMode(deps, input.operation);
    const fileSelector = await findAttachedSelector(
        deps.page,
        IMAGE_FILE_INPUT,
        'image file input',
        deps.stepTimeoutMs,
    );
    // One ordered call: the console keeps the batch in payload order, and that order is the post.
    await deps.page.setInputFiles(fileSelector, input.images);
    await confirmThumbnails(deps, input.images.length);
    await applyNoteTitle(deps);
    await typeNoteBody(deps, NOTE_BODY, 'note body');
}

async function composeVideo(input: { operation: '上传视频'; video: string }, deps: ModeRunDeps): Promise<void> {
    await enterMode(deps, input.operation);
    const fileSelector = await findAttachedSelector(
        deps.page,
        VIDEO_FILE_INPUT,
        'video file input',
        deps.stepTimeoutMs,
    );
    await uploadFile(asPlaywrightPage(deps.page), fileSelector, input.video, { timeoutMs: deps.stepTimeoutMs });
    // The note editor only exists once the video is attached (discovery §2).
    await findSelector(deps.page, VIDEO_EDITOR, 'video note editor', deps.stepTimeoutMs);
    // The video note is the same note composer as 图文 (`话题` / `用户` / `表情` / `关联`), so the
    // title field is the shared note title. Not re-measured for the video tab in the walk.
    await applyNoteTitle(deps);
    await typeNoteBody(deps, NOTE_BODY, 'note body');
}

async function composeArticle(deps: ModeRunDeps): Promise<void> {
    await enterMode(deps, '写长文');
    const newArticle = await findAttachedSelector(deps.page, ARTICLE_NEW, '新的创作 control', deps.stepTimeoutMs);
    await deps.page.locator(newArticle).first().click();
    const editor = await findSelector(deps.page, ARTICLE_EDITOR, 'long-article editor', deps.stepTimeoutMs);
    // Authored IN PLACE: the raw markdown is the input (no 导入链接 — that is fed from a 公众号
    // source), and the insertion is a real paste through the shared E91-D4 helper. It is pasted as
    // rendered HTML because ProseMirror would otherwise keep the markdown syntax as literal text;
    // `一键排版` is what then formats the pasted content for the platform.
    await pasteHtml(asPlaywrightPage(deps.page), editor, markdownToHtml(deps.content.body), {
        timeoutMs: deps.stepTimeoutMs,
    });
    // 一键排版 applies the layout DIRECTLY on xhs. Measured live (dogfood 2026-10-05): a
    // hit-test-verified click produced no option menu — the only new text was `自动保存于 …` — and a
    // CDP-pierced scan found none either. The `保留源格式 / 匹配目标格式 / 仅保留文本` trio is WeChat
    // MP's option set, not xhs's, and requiring it here failed a real draft run. So: click it when
    // the control exists, and treat its absence as a non-event — the layout step is an enhancement,
    // never a gate on saving.
    try {
        const layout = await findSelector(deps.page, ARTICLE_LAYOUT, '一键排版 control', deps.stepTimeoutMs);
        await deps.page.locator(layout).first().click();
    } catch {
        // No layout control on this editor build — the draft still saves.
    }
}

async function isPodcastModalOpen(page: XhsPage): Promise<boolean> {
    return trySelectors(page, PODCAST_MODAL)
        .then((found) => found.found)
        .catch(() => false);
}

/**
 * Leave the 发播客 modal. 0236 R3 is now measured (2026-11-06 headless probe): the modal's only
 * controls are `取消` and the light-DOM `去发布`, and `去发布` does not publish — it opens the full
 * podcast editor whose action bar is the same closed-shadow `暂存离开`/`发布` pair every other mode
 * uses, so BOTH publish statuses take the same advance click and the draft decision moves to the
 * editor's action bar (MODE_ACTION_PATHS['发播客'] already routes `shadow`). Draft saving
 * waits for the modal to close by itself first — only that timed-dead path names what it saw.
 */
async function leavePodcastModal(deps: ModeRunDeps): Promise<void> {
    const closed = () => isPodcastModalOpen(deps.page).then((open) => !open);
    if (await waitUntil(closed, deps.stepTimeoutMs)) return;
    const advance = await clickLightControl(
        deps.page,
        PODCAST_MODAL_ADVANCE,
        deps.stepTimeoutMs,
        'podcast modal advance',
    );
    if (!advance.ok) throw new Error(advance.error);
    if (await waitUntil(closed, deps.stepTimeoutMs)) return;
    throw new Error(
        `podcast modal: the 发播客 modal stayed open ${deps.stepTimeoutMs}ms after the advance click; the measured 2026-11-06 flow moves to the podcast editor page with the closed-shadow '${DRAFT_LABELS[0]}' bar, so a fast re-measure with a fresh probe is the next step, not a retry`,
    );
}

async function composePodcast(
    input: { operation: '发播客'; audio: string; cover: string },
    deps: ModeRunDeps,
): Promise<void> {
    await enterMode(deps, input.operation);
    const open = await findAttachedSelector(deps.page, PODCAST_OPEN, '上传音频 control', deps.stepTimeoutMs);
    await deps.page.locator(open).first().click();
    await findSelector(deps.page, PODCAST_MODAL, 'podcast modal', deps.stepTimeoutMs);
    const audioInput = await findAttachedSelector(
        deps.page,
        PODCAST_AUDIO_INPUT,
        'podcast audio input',
        deps.stepTimeoutMs,
    );
    await uploadFile(asPlaywrightPage(deps.page), audioInput, input.audio, { timeoutMs: deps.stepTimeoutMs });
    // The audio card's acknowledgement is the registration signal: no ack in the window means the
    // assignment did not take, and the cover chooser would then find `去发布` disabled and stall.
    const ack = await waitUntil(async () => {
        try {
            return (await deps.page.locator(`text=${PODCAST_UPLOAD_ACK}`).count()) > 0;
        } catch {
            return false;
        }
    }, deps.stepTimeoutMs);
    if (!ack) {
        throw new Error(
            `podcast modal: the audio card never showed '${PODCAST_UPLOAD_ACK}' within ${deps.stepTimeoutMs}ms of the file assignment; mimic-file upload of ${input.audio.split('/').pop()} did not register`,
        );
    }
    await uploadPodcastCover(deps, input.cover);
    await podcastAdvanceReady(deps);
    await leavePodcastModal(deps);
}

async function uploadPodcastCover(deps: ModeRunDeps, cover: string): Promise<void> {
    const zone = deps.page.locator(PODCAST_COVER_ZONE).first();
    const box = await zone.boundingBox().catch(() => null);
    if (!box) {
        throw new Error(`podcast modal: the cover card ('${PODCAST_COVER_ZONE}') has no bounding box to click`);
    }
    if (!deps.page.mouse) {
        throw new Error('podcast modal: the page seam does not expose a raw mouse for the cover-card coordinate click');
    }
    const chooser = deps.page.waitForEvent?.('filechooser', { timeout: 8_000 }).catch(() => null) as Promise<
        unknown | null
    >;
    await deps.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const opened = await chooser;
    if (!opened) {
        throw new Error('podcast modal: clicking the cover card did not open a native file chooser within 8000ms');
    }
    await (opened as { setFiles(path: string): Promise<void> }).setFiles(cover);
}

/** Wait until the advance control is enabled — `去发布` stays `disabled` until BOTH cards took. */
async function podcastAdvanceReady(deps: ModeRunDeps): Promise<void> {
    if (deps.publishStatus !== 'draft') {
        return;
    }
    const enabled = await waitUntil(async () => {
        try {
            if ((await deps.page.locator('button:has-text("去发布")').count()) === 0) return false;
            const disabled = await deps.page
                .locator('button:has-text("去发布")[disabled], button:has-text("去发布")[aria-disabled="true"]')
                .count();
            return disabled === 0;
        } catch {
            return false;
        }
    }, deps.stepTimeoutMs);
    if (!enabled) {
        throw new Error(
            `podcast modal: '${PODCAST_MODAL_ADVANCE[0]}' stayed disabled — the cards were not both accepted; check the audio ack '${PODCAST_UPLOAD_ACK}' and retry with the cover chooser path`,
        );
    }
}

/** Compose the requested mode's post. Exhaustive over {@link ModeInput}. */
async function compose(input: ModeInput, deps: ModeRunDeps): Promise<void> {
    switch (input.operation) {
        case '上传图文':
            await composeImageText(input, deps);
            return;
        case '上传视频':
            await composeVideo(input, deps);
            return;
        case '写长文':
            await composeArticle(deps);
            return;
        case '发播客':
            await composePodcast(input, deps);
            return;
    }
}

function baseMetadata(input: ModeInput, deps: ModeRunDeps): Record<string, unknown> {
    return {
        operation: input.operation,
        driver: deps.driver,
        publishStatus: deps.publishStatus,
        profileDir: deps.profileDir,
        artifactPaths: artifactPaths(input),
        ...(input.operation === '上传图文' ? { imageCount: input.images.length } : {}),
    };
}

/**
 * Save the post as a draft: settle, click this mode's 暂存离开, then require an OBSERVED signal.
 * The click is retried (the console drops one that lands while the note is still settling) but the
 * signal is never assumed: an unobserved save is `ok:false` naming the label and the deadline.
 */
async function saveDraft(input: ModeInput, deps: ModeRunDeps): Promise<Result> {
    let clicked: ActionClick | null = null;
    let signal: string | null = null;
    let attempts = 0;
    while (signal === null && attempts < deps.submitAttempts) {
        attempts += 1;
        await sleep(deps.submitSettleMs);
        const control = await clickActionControl(input.operation, deps, DRAFT_LABELS, 'draft control');
        if (!control.ok) return fail(control.error);
        clicked = control;
        const outcome = await expectOutcome(() => draftSignalEvidence(deps.page, deps.draftBaseline), {
            timeoutMs: deps.submitSettleMs,
            label: `draft confirmation '${control.label}'`,
            pollMs: POLL_MS,
        });
        if (outcome.ok) signal = outcome.evidence;
    }
    const draftCountAfter = await readDraftCount(deps.page);
    if (signal === null || clicked === null) {
        return fail(
            `draft confirmation: '${clicked?.label ?? DRAFT_LABELS[0]}' was clicked ${attempts}× but neither a fresh ${TARGET} save timestamp, a moved draft counter, nor a scoped '${DRAFT_TOASTS[0]}' toast was observed within ${deps.submitSettleMs}ms (before=${String(deps.draftBaseline.count)}, after=${String(draftCountAfter)})`,
        );
    }
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        message: `${TARGET} draft saved (unpublished) in profile ${deps.profileDir} via '${clicked.label}' (${input.operation})`,
        metadata: {
            ...baseMetadata(input, deps),
            draftControl: clicked.label,
            draftClick: clicked.click,
            draftPath: clicked.path,
            draftAttempts: attempts,
            draftSignal: signal,
            draftCountBefore: deps.draftBaseline.count,
            draftCountAfter,
        },
    });
}

/**
 * Publish the post. Reached only for an explicit `publishStatus: 'public'` — the transport refuses
 * every other value before a browser opens, so no other path can click a publish control. ONE
 * click, no retry: an unobserved publish must never be repeated, and the console drops a click that
 * lands while the note is still settling.
 */
async function publishNote(input: ModeInput, deps: ModeRunDeps): Promise<Result> {
    await sleep(deps.submitSettleMs);
    const submitted = await clickActionControl(input.operation, deps, PUBLISH_LABELS, 'publish control');
    if (!submitted.ok) return fail(submitted.error);

    const urlBeforeSubmit = deps.page.url();
    const confirmed = await waitUntil(async () => {
        // The console rewrites its URL to `…published=true` once the post is accepted; the toast is
        // the fallback, read scoped (never from the document at large).
        if (deps.page.url().includes(PUBLISHED_MARKER)) return true;
        return (await readScopedSignal(asPlaywrightPage(deps.page), PUBLISH_CONFIRM)) !== null;
    }, deps.stepTimeoutMs);
    if (!confirmed) {
        return fail(
            `publish submission: state unknown — the '${submitted.label}' click (${submitted.click}) was sent from ${urlBeforeSubmit} but no success state was observed (now ${deps.page.url()}). Check the ${TARGET} creator note manager before retrying: a retry could duplicate the post.`,
        );
    }
    const url = deps.page.url();
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        ...(url !== PUBLISH_URL ? { url } : {}),
        message: `${TARGET} ${input.operation} post published`,
        metadata: {
            ...baseMetadata(input, deps),
            publishControl: submitted.label,
            publishPath: submitted.path,
            publishClick: submitted.click,
            publishSignal: url.includes(PUBLISHED_MARKER) ? `url:${PUBLISHED_MARKER}` : 'toast',
        },
    });
}

/**
 * Run one validated operation end to end: compose the post, then take it to a draft or (only on an
 * explicit live request) publish it.
 */
export async function runMode(input: ModeInput, deps: ModeRunDeps): Promise<Result> {
    await compose(input, deps);
    return deps.publishStatus === 'public' ? publishNote(input, deps) : saveDraft(input, deps);
}
