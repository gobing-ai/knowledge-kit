import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import type { Content, Result } from '@gobing-ai/kk-core';
import { ResultSchema } from '@gobing-ai/kk-core';
import { trySelectors } from '@gobing-ai/publish-harness';
import {
    DEFAULT_SIGNAL_CONTAINERS,
    expectOutcome,
    mkdirExclusive,
    pasteHtml,
    readScopedSignal,
    rmdir,
    uploadFile,
    waitUntil,
} from '@gobing-ai/publish-harness/browser';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { Page } from 'playwright';
import { readLocalImageBytes } from './cgi';
import {
    assertEligibleCgiDraft,
    createWechatArticleDraft,
    extractWechatCgiSession,
    WechatCgiDraftError,
} from './cgi-draft';
import { prepareArticleMedia, type WechatArticleMedia } from './cgi-media';
import { enrichArticle } from './enrich';
import {
    artifactPaths,
    CREATE_TYPES,
    coverPath,
    editorUrl,
    type ModeInput,
    readConsoleToken,
    readCreateType,
    TARGET,
    type WechatmpOperation,
} from './modes';
import {
    clickSelector,
    fillSelector,
    findAttachedSelector,
    findSelector,
    followNewPage,
    modalState,
    sanitizeSessionEvidence,
    tryFindSelector,
    type WechatPage,
    waitForVisible,
} from './page';

/**
 * The four wechatmp flows (ADR-029: the operation owns its entry, selector table, artifacts and
 * success signal) plus the rails they share — mode entry, the 一键排版 steps, the 从正文选择 cover
 * step, the 草稿箱 signal probe and the publish path.
 *
 * `docs/design/wechatmp-ui-discovery.md` is the evidence for every selector here; where the
 * recorded evidence does not cover a detail the code says so rather than inventing one, and the
 * candidate lists are the live dogfood's re-measurement surface.
 */

/** The console home's creation menu: items carry `div.new-creation__menu-title` labels (§1). */
const CREATION_MENU_ITEM = 'div.new-creation__menu-item';
/** The menu is opened from the console's own 新的创作 control (§1). */
const CREATION_MENU_OPEN = ['text=新的创作', 'div.new-creation__menu-title:has-text("新的创作")'];

/** The title is the ProseMirror block; 文章's placeholder is 请在这里输入标题, 贴图's …（选填）. */
const TITLE_BLOCK = [
    'div.ProseMirror[data-placeholder^="请在这里输入标题"]',
    'div.ProseMirror[data-placeholder*="标题"]',
];
/** `textarea#title` is the HIDDEN form mirror — filling it alone saves an EMPTY title (§5.2 trap 1). */
const TITLE_MIRROR = ['textarea#title', 'textarea.js_title'];
/** The body is the second ProseMirror instance: `ProseMirror-focused`, no `data-placeholder` (§5.2). */
const BODY_BLOCK = [
    'div.ProseMirror.ProseMirror-focused:not([data-placeholder])',
    'div.ProseMirror:not([data-placeholder])',
    'div.ProseMirror[contenteditable="true"]',
];
/** 文章's 摘要 (`textarea#js_description`, 0/120, 选填) and 作者 (`input#author`, 0/8, 原创-gated). */
const DIGEST_INPUT = ['textarea#js_description', 'textarea.js_desc'];
const AUTHOR_INPUT = ['input#author', 'input.js_author'];
/** The editor's own image input (§3: `accept="image/gif,image/jpeg,image/jpg,image/png,image/svg,image/webp"`). */
const IMAGE_FILE_INPUT = ['input[type="file"][accept*="image/"]', 'input[type="file"][accept*=".png"]'];

/** `一键排版` and its measured UEditor menu (see applyLayout). */
const LAYOUT_CONTROL = ['button:has-text("一键排版")', 'div.ailayout-btn_wrp', 'div.ailayout-btn_label'];
const LAYOUT_TARGET = [
    'div.edui-popup:visible .edui-pastecontainer > .edui-button > div.edui-default:nth-child(2)',
    'div[role="menuitem"]:has-text("匹配目标格式")',
    'li:has-text("匹配目标格式")',
];
/** November 2 live console: the layout control opens a full-page preview with this commit action. */
const LAYOUT_PREVIEW_APPLY = ['button:has-text("使用此排版")', 'a:has-text("使用此排版")', 'text=使用此排版'];
const LAYOUT_TARGET_MARKER = '__KK_WECHAT_LAYOUT_TARGET__';
const LAYOUT_SAVE_STATE_MARKER = '__KK_WECHAT_LAYOUT_SAVE_STATE__';
const LEGACY_EDITOR_READY_MARKER = '__KK_WECHAT_LEGACY_EDITOR_READY__';

/**
 * 封面 has NO file input (§5.2): the panel offers `修改` / `换一张` / `从正文选择`
 * (`a.js_selectCoverFromContent`) / `从图片库选择` (`a.js_imagedialog`) / 微信扫码上传 / AI 配图.
 * `从图片库选择` is the default because the daily flow uploads the episode cover there as the audio
 * material's cover, so the library holds exactly the image the operator wants (2026-10-10);
 * `从正文选择` remains selectable via `metadata.wechatmp.coverSource`.
 */
const COVER_PANEL_OPEN = [
    '.js_cover_btn_area:visible',
    'text=换一张',
    'text=修改',
    'a.js_selectCoverFromContent:visible',
];
const COVER_FROM_CONTENT = [
    '#js_cover_area a.js_selectCoverFromContent:visible',
    'a.js_selectCoverFromContent:visible',
];
const COVER_FROM_LIBRARY = ['#js_cover_area a.js_imagedialog:visible', 'a.js_imagedialog:visible'];
/** The library picker is two-stage: pick the image, then 下一步, then the dialog's 确认. */
const COVER_LIBRARY_NEXT = [
    '.weui-desktop-dialog:visible:has(h3:has-text("选择图片")) button:has-text("下一步")',
    'button:has-text("下一步")',
];
/**
 * The panel's own image list is NOT `<img>`-based (measured `panels: 5, imgs: 0`), so the item and
 * confirm selectors below are candidate shapes and **not** re-measured (§6 still lists the widget as
 * to do). A miss is recorded as a warning, never as a false cover claim.
 */
const COVER_CONFIRM = [
    '.weui-desktop-dialog:visible:has(h3:has-text("编辑封面")) button:text-is("确认")',
    '.weui-desktop-dialog:visible:has(h3:has-text("选择图片")) button:has-text("完成"):not(.weui-desktop-btn_disabled)',
    'button:has-text("确定")',
    'button:has-text("确认")',
    'button:has-text("完成")',
];

/** The controls that close whatever modal the cover step left open, most specific first. */
const DIALOG_DISMISS = [
    '.weui-desktop-dialog:visible button:has-text("取消")',
    '.weui-desktop-dialog__close',
    'button:has-text("取消")',
];

/**
 * Close an open console dialog, best-effort. Measured 2026-10-12: `setCover` returned its warning
 * while the cover panel stayed open, and an open panel's footer (`div.weui-desktop-dialog__ft`)
 * covers the editor — 赞赏 / 原文链接 / 创作来源 / 音频 each click-timed out behind it and the final
 * `保存为草稿` was blocked for 30 s, so the run saved no draft at all. The same sweep shape the
 * settings rail already uses (`./enrich`): the dialog's own 取消, else Escape.
 */
async function dismissOpenDialog(page: WechatPage): Promise<void> {
    for (const selector of DIALOG_DISMISS) {
        const control = await tryFindSelector(page, [selector], 2_000);
        if (control === undefined) continue;
        try {
            await clickSelector(page, control, 2_000);
        } catch {
            // Gone between the probe and the click — nothing left to dismiss.
        }
        break;
    }
    await page.press?.('Escape');
    await page.waitForTimeout?.(400);
}

/** The close controls a console modal exposes, most specific first (the audio picker shows no 取消).
 *  `.weui-desktop-dialog__close-btn` is the 0272-captured audio-dialog variant the bare `__close`
 *  probe missed. */
const DIALOG_CLOSE = [
    '.weui-desktop-dialog__wrp .weui-desktop-dialog__close',
    '.weui-desktop-dialog__close',
    '.weui-desktop-dialog__close-btn',
    '.weui-desktop-dialog__wrp button:has-text("取消")',
    'button:has-text("取消")',
];

/**
 * Close every open console modal before a submit click. Measured 2026-10-12: the 插入音频 dialog
 * (`weui-desktop-dialog__wrp align_edge audio_dialog js_audio_music_dialog`) stayed open after its
 * own 上传音频 click timed out, its footer covered `保存为草稿` for 30 s, and the run saved no draft
 * at all. A failed enrichment is a warning by contract, never a gate — so nothing may outlive it.
 *
 * Returns `'residual'` when a dialog is still open — or its state is UNREADABLE — after all passes:
 * an unknown overlay must never read as cleaned up (task 0260 R3/AC5).
 */
async function closeOpenDialogs(page: WechatPage): Promise<'closed' | 'residual'> {
    for (let pass = 0; pass < 3; pass += 1) {
        const state = await modalState(page);
        if (state === 'closed') return 'closed';
        for (const selector of DIALOG_CLOSE) {
            const control = await tryFindSelector(page, [selector], 1_500);
            if (control === undefined) continue;
            try {
                await clickSelector(page, control, 2_000);
            } catch {
                // Gone between the probe and the click.
            }
            break;
        }
        await page.press?.('Escape');
        await page.waitForTimeout?.(400);
    }
    return (await modalState(page)) === 'closed' ? 'closed' : 'residual';
}

/** 视频's media modal (§5.2): tabs 素材库/视频号动态/视频链接 + 本地上传 + 确定/取消. */
const VIDEO_LOCAL_UPLOAD = ['text=本地上传', 'button:has-text("本地上传")'];
const VIDEO_FILE_INPUT = [
    'div.weui-desktop-dialog input[type="file"][accept*="video"]',
    'input[type="file"][accept*="video"]',
    'input[type="file"][accept*=".mp4"]',
    'div.weui-desktop-dialog input[type="file"]',
];
const VIDEO_CONFIRM = ['div.weui-desktop-dialog button:has-text("确定")', 'button:has-text("确定")'];

/** 播客's media modal (§5.2): 从素材库选择 + 搜索音频 + 上传音频 + 插入/取消. */
const PODCAST_UPLOAD = ['text=上传音频', 'button:has-text("上传音频")'];
const PODCAST_AUDIO_INPUT = [
    'div.weui-desktop-dialog input[type="file"][accept*="audio"]',
    'div.weui-desktop-dialog input[type="file"][accept*=".mp3"]',
    'input[type="file"][accept*="audio"]',
    'input[type="file"][accept*=".mp3"]',
];
/**
 * The 播客 cover stays scoped to the modal: the editor's own image input carries an `image/…`
 * accept list too, and picking that one would attach the cover as *body* content instead.
 */
const PODCAST_COVER_INPUT = [
    'div.weui-desktop-dialog input[type="file"][accept*="image/"]',
    'div.weui-desktop-dialog input[type="file"][accept*=".png"]',
    'div.weui-desktop-dialog input[type="file"][accept*=".jpg"]',
];
const PODCAST_INSERT = ['div.weui-desktop-dialog button:has-text("插入")', 'button:has-text("插入")'];

/** 音频 material dialog: the toolbar menu opens it, then the 素材库 list or the upload form. */
const AUDIO_MENU = 'li.js_insertaudio';
/** The toolbar dropdown that reveals the 音频 menu item (measured 2026-10-13): the item lives in a
 *  `display:none` menu under `#audio_music_plugin_btn` until that trigger is clicked. */
const AUDIO_TOOLBAR_TRIGGER = '#audio_music_plugin_btn';
const AUDIO_DIALOG = '.audio_dialog';
/** The 素材库 rows stream in after the dialog opens, so the dedupe probe retries while they load. */
const AUDIO_DIALOG_TIMEOUT_MS = 15_000;
const AUDIO_ROW_RETRIES = 2;
const AUDIO_ROW_SETTLE_MS = 1_200;
/**
 * The upload form (operator walk 2026-10-10: `上传音频` → file → `上传封面` → file → title → agree →
 * 保存). The form lives inside the audio dialog, so the file inputs stay scoped to it.
 */
const UPLOAD_AUDIO = ['text=上传音频', 'button:has-text("上传音频")'];
const AUDIO_UPLOAD_INPUT = [
    '.weui-desktop-dialog input[type="file"][accept*="audio"]',
    '.weui-desktop-dialog input[type="file"][accept*=".mp3"]',
    '.audio_dialog input[type="file"][accept*="audio"]',
    'input[type="file"][accept*=".mp3"]',
    // 2026-10-21 measured: this build's upload form exposes a plain `input[type=file]` with NO accept
    // attribute, so every accept-qualified candidate above missed and the run reported `音频: no audio
    // file input appeared` — which costs the draft its audio player, the audio material's cover, and
    // the library cover the 封面 step reuses. Dialog-scoped on purpose: the editor's own image input
    // lives outside `.weui-desktop-dialog`, so it can never be the winner here.
    '.weui-desktop-dialog input[type="file"]:not([accept*="image"])',
    '.audio_dialog input[type="file"]:not([accept*="image"])',
];
const UPLOAD_COVER = ['text=上传封面', 'button:has-text("上传封面")'];
const AUDIO_COVER_INPUT = [
    '.weui-desktop-dialog input[type="file"][accept*="image/"]',
    '.audio_dialog input[type="file"][accept*="image/"]',
    'input[type="file"][accept*=".png"]',
    // 2026-10-21 measured: the upload form's cover input carries `image/bmp, image/png, image/jpeg,
    // image/jpg, image/gif, image/webp` — space-separated MIME names WITHOUT a slash-terminated
    // `image/` prefix match (`accept*="image/"` misses `image/bmp`), so the cover upload silently
    // skipped on every run and the draft shipped with no cover.
    '.weui-desktop-dialog input[type="file"][accept*="image"]',
    '.audio_dialog input[type="file"][accept*="image"]',
    // The image chooser portals this input outside its dialog; the toolbar input excludes BMP.
    'input[type="file"][accept*="image/bmp"]',
];
const AUDIO_TITLE_INPUT = [
    '.weui-desktop-dialog input[placeholder*="标题"]',
    '.audio_dialog input[placeholder*="标题"]',
    '.audio_dialog input.frm_input',
];
const UPLOAD_SAVE = ['.audio-upload-dialog button:text-is("保存")', '.weui-desktop-dialog button:text-is("保存")'];

/** The recorded save control. `发表` is never clicked on a draft run (ADR-022/ADR-026). */
const SAVE_DRAFT = ['button:has-text("保存为草稿")', 'text=保存为草稿'];
const PUBLISH_SEND = ['button.mass_send', '.mass_send', 'button:has-text("发表")'];
/** Live 2026-11-02 mass-send dialog: the final action is the green 发表 button, not 确定. */
const PUBLISH_DIALOG = ['div.weui-desktop-dialog:visible:has(h3.weui-desktop-dialog__title:text-is("发表"))'];
const PUBLISH_NOTIFY_TOGGLE = [
    'div.weui-desktop-dialog:visible:has(h3.weui-desktop-dialog__title:text-is("发表")) .mass_send__notify .weui-desktop-switch__input:visible',
];
const PUBLISH_NOTIFY_STATE_SCRIPT = `(() => {
    const dialog = [...document.querySelectorAll('.weui-desktop-dialog')].find((candidate) => {
        const title = candidate.querySelector('h3.weui-desktop-dialog__title')?.textContent?.trim();
        const rect = candidate.getBoundingClientRect();
        return title === '发表' && rect.width > 0 && rect.height > 0;
    });
    const input = dialog?.querySelector('.mass_send__notify input.weui-desktop-switch__input');
    return input instanceof HTMLInputElement ? input.checked : null;
})()`;
const PUBLISH_FINAL = [
    'div.weui-desktop-dialog:visible:has(h3.weui-desktop-dialog__title:text-is("发表")) .mass-send__footer button.weui-desktop-btn_primary:text-is("发表")',
];
/** Known pre-confirmation stale-version dialog action; it is never a generic retry control. */
const PUBLISH_VIEW_LATEST = [
    'div.version_fail_dialog:visible a.btn_primary.js_btn:text-is("查看新草稿"):visible',
    'div.weui-desktop-dialog:visible button:text-is("查看新草稿")',
    'div.weui-desktop-dialog:visible a:text-is("查看新草稿")',
    'div.weui-desktop-dialog:visible [role="button"]:text-is("查看新草稿")',
    'div.weui-desktop-dialog:visible button:has-text("查看新草稿")',
];
const PUBLISH_SUCCESS = ['发表成功', '已发表'];
const PUBLIC_SAVE_REFUSAL = ['当前编辑的草稿不是最新版本'];
const PUBLIC_SAVE_REFUSAL_CONTAINERS = [
    ...DEFAULT_SIGNAL_CONTAINERS,
    'div.version_fail_dialog:visible',
    'div.weui-desktop-dialog:visible',
];

async function readStaleVersionRefusal(page: Page): Promise<string | null> {
    return readScopedSignal(page, PUBLIC_SAVE_REFUSAL, PUBLIC_SAVE_REFUSAL_CONTAINERS);
}
/**
 * The platform's own refusal/hint lines (§5, §5.3) — relayed as the Result's actionable message
 * instead of a generic failure. `系统繁忙，请稍后再试` is deliberately absent: it appears routinely
 * and is NOT a failure indicator (§5.1).
 */
const PLATFORM_REFUSAL = [
    '内容不完整，无法发表',
    '请补充封面图',
    '必须插入一张图片',
    '未设置头像和名称',
    '公众号尚未实名',
    '当前编辑的草稿不是最新版本',
];

/** The 草稿箱 row's own update label (§5.1: `kk-discovery-文章 请忽略 … 更新于 13:12`). */
const DRAFT_STAMP = '更新于';

/** A confirm dialog the platform itself raises mounts immediately; it must not cost a step timeout. */
const CONFIRM_TIMEOUT_MS = 5_000;
/** Page-side scan for a console link carrying the session token (`token=<N>`, §1). */
const TOKEN_LINK_SCRIPT = `(() => {
    const link = [...document.querySelectorAll('a[href*="token="]')]
        .map((a) => a.href)
        .find((href) => /[?&]token=\\d+/.test(href));
    return link ? (new URL(link).searchParams.get('token') ?? '') : '';
})()`;

/** Everything the flows need besides the validated mode input. */
export interface ModeRunDeps {
    /** The console home (entry page): the creation menu and the 草稿箱 signal live here. */
    entry: WechatPage;
    /** Every page the context holds — the editor is the NEWEST one (discovery §1). */
    pages: () => WechatPage[];
    /** Opens an extra tab for the token-derived editor route, so the home stays readable. */
    newPage: () => Promise<WechatPage>;
    content: Content;
    publishStatus: 'draft' | 'public';
    profileDir: string;
    driver: string;
    stepTimeoutMs: number;
    /** Re-poll interval for the observed-signal waits — injectable so tests need no real-time waiting. */
    pollMs: number;
    /** Settle before the save click. */
    submitSettleMs: number;
    /** How long the observed draft signal is waited for after a save click. */
    draftTimeoutMs: number;
    submitAttempts: number;
    /** 草稿箱 evidence captured before the editor opened (MP auto-saves, so a row can pre-exist). */
    draftBaseline: DraftBaseline;
}

/** The 草稿箱 stamp observed before the editor opened — the freshness baseline of the signal. */
export interface DraftBaseline {
    stamp: string | null;
}

interface ModeEntry {
    /** The page every editor step acts on: the tab the creation click opened, or the route tab. */
    editor: WechatPage;
    /** Which verified entry path was used. */
    path: 'menu' | 'route';
    /** The `createType` the editor URL reported, or null when the URL did not carry it. */
    createType: number | null;
}

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error: sanitizeSessionEvidence(error) });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function titleOf(content: Content): string {
    return (content.title ?? '').trim();
}

function bodyOf(content: Content): string {
    return content.body ?? '';
}

/**
 * The shared helpers are declared against Playwright's `Page`, while the flows drive the structural
 * `WechatPage` seam (which is what lets the offline tests script the console). Every member those
 * helpers touch — `locator`, `evaluate`, `setInputFiles` — is implemented by `wrapPlaywrightPage`,
 * so this is a type-level bridge over the same object, not a second page.
 */
function asPlaywrightPage(page: WechatPage): Page {
    return page as unknown as Page;
}

/**
 * The 草稿箱 row's scope for one title.
 *
 * The walk recorded the row's TEXT (`… 更新于 13:12`), not its class, so the containers are the
 * platform's own draft/appmsg naming (its editor routes are `appmsg*`) plus the row's title text —
 * a candidate list keyed to this run's title, never the document at large, where the article the
 * flow just pasted would satisfy the probe (ADR-029 mandatory rail).
 */
export function draftRowContainers(title: string): string[] {
    const keyed = title.length > 0 ? `:has-text(${JSON.stringify(title)})` : '';
    // Kept narrow: a broad list (`li` / `[class*="list" i]` / media wrappers) made the per-poll
    // `:has-text` probe slow enough on the real list to look like a hang, and it still missed the row —
    // the draft rows appear to live inside an iframe on the list route (2026-10-05).
    // `.weui-desktop-card` is the real row: live 2026-10-05 the 近期草稿 card on the console home is
    // `div.weui-desktop-card.weui-desktop-publish` under `div.publish_card_container`, and it carries
    // both the title and the `更新于` stamp. Kept narrow — a broad list (`li` / `[class*="list" i]`)
    // made the per-poll `:has-text` probe slow enough on the real page to look like a hang.
    return [
        `.weui-desktop-card${keyed}`,
        `.publish_card_container${keyed}`,
        `[class*="draft" i]${keyed}`,
        `[class*="appmsg" i]${keyed}`,
        `.weui-desktop-dialog${keyed}`,
    ];
}

/**
 * The console home route — which is where the 草稿箱 rows actually are.
 *
 * Live 2026-10-05 (authenticated probe): the home page (`t=home/index`) carries the draft cards with
 * their `更新于` stamps, while `t=media/appmsg_list&action=list_card` — the route the 草稿箱 entry
 * links to — renders **no** draft rows at all, and every page is a single frame (no iframes).
 * Navigating to the appmsg route was therefore the bug that produced `before=none, after=none`.
 */
const draftBoxUrl = (token: string): string =>
    `https://mp.weixin.qq.com/cgi-bin/home?t=home/index&lang=zh_CN&token=${encodeURIComponent(token)}`;

/**
 * Land on the console home and wait (bounded) for its 近期草稿 cards to render.
 *
 * The cards stream in after the navigation, so a fixed sleep can read too early — that is the other
 * half of the observed `before=none, after=none` miss. It navigates instead of clicking the nav entry:
 * a click can open a new tab and never settle, which hung a run for 7 min with no output (no step
 * timeout fires for that), while a bounded `goto` always returns or throws. Best-effort — a failure
 * leaves the read to the probe loop, which reports an honest `ok:false` rather than a fabricated one.
 */
export async function openDraftBox(
    page: WechatPage,
    title: string,
    timeoutMs: number,
    pollMs: number,
): Promise<boolean> {
    try {
        const token = await resolveConsoleToken(page);
        if (token === undefined) return false;
        await page.goto(draftBoxUrl(token), { timeout: timeoutMs });
        const ready = await expectOutcome(
            async () => {
                // Container-qualified and title-keyed exactly like the read — a bare `:text(更新于)` probe
                // would be satisfied by the pasted article body (the scoping test enforces this), and a
                // fixed sleep can read before the cards stream in, which is the other half of the miss.
                for (const container of draftRowContainers(title)) {
                    const selector = `${container} :text("${DRAFT_STAMP}")`;
                    if ((await page.locator(selector).count()) > 0) return selector;
                }
                return null;
            },
            {
                timeoutMs,
                label: `草稿箱 cards on the console home (:text("${DRAFT_STAMP}") inside the row containers)`,
                pollMs,
            },
        );
        return ready.ok;
    } catch {
        return false;
    }
}

/**
 * The 草稿箱 row's `更新于` stamp for one title, read through `readScopedSignal` so it can only come
 * from a 草稿箱 container — never from the editor body this flow just typed into.
 */
/**
 * A bounded frame inventory for the 草稿箱 failure message.
 *
 * Live 2026-10-05 the row demonstrably existed and the list route was reached, yet the main frame read
 * empty and no selector change helped. So report the frames that were actually there (and how many
 * `更新于` stamps each held) instead of guessing again. The fakes expose no `frames()`; they get ''.
 */
async function describeFrames(page: WechatPage, limit: number): Promise<string> {
    const frames = typeof page.frames === 'function' ? page.frames() : [];
    const parts: string[] = [];
    for (const frame of frames.slice(0, limit)) {
        const stamped = await frame
            .locator(`:text("${DRAFT_STAMP}")`)
            .count()
            .catch(() => -1);
        parts.push(`${frame.url().slice(0, 60)}:${stamped}`);
    }
    return parts.join(' | ');
}

export async function readDraftStamp(page: WechatPage, title: string): Promise<string | null> {
    return readScopedSignal(asPlaywrightPage(page), [DRAFT_STAMP], draftRowContainers(title));
}

/** 草稿箱 evidence captured before the editor is entered (MP auto-saves continuously, §5.1). */
export async function readDraftBaseline(page: WechatPage, title: string): Promise<DraftBaseline> {
    return { stamp: await readDraftStamp(page, title) };
}

/** The session token: the console URL first, then a console link on the page (§1). */
async function resolveConsoleToken(page: WechatPage): Promise<string | undefined> {
    const fromUrl = readConsoleToken(page.url());
    if (fromUrl !== undefined) return fromUrl;
    const fromLink = String(await page.evaluate(TOKEN_LINK_SCRIPT)).trim();
    return fromLink.length > 0 ? fromLink : undefined;
}

/** The creation-menu item carrying this mode's label. */
function creationItemSelectors(operation: WechatmpOperation): string[] {
    return [
        `${CREATION_MENU_ITEM}:has-text("${operation}")`,
        `${CREATION_MENU_ITEM} .new-creation__menu-title:has-text("${operation}")`,
    ];
}

/**
 * Enter the mode through the console's own 新的创作 menu — the path the walk used, which opens the
 * editor in a NEW TAB (§1). Returns `undefined` when the menu offers no item for the mode, or opens
 * no tab, so the caller can fall back to the token-derived route.
 */
async function enterViaMenu(deps: ModeRunDeps, operation: WechatmpOperation): Promise<WechatPage | undefined> {
    const selectors = creationItemSelectors(operation);
    let item = await tryFindSelector(deps.entry, selectors, Math.min(deps.stepTimeoutMs, 5_000));
    if (item === undefined) {
        // The menu renders closed until the console's own 新的创作 control opens it (§1).
        const opener = await tryFindSelector(deps.entry, CREATION_MENU_OPEN, deps.stepTimeoutMs);
        if (opener === undefined) return undefined;
        await clickSelector(deps.entry, opener, deps.stepTimeoutMs);
        item = await tryFindSelector(deps.entry, selectors, deps.stepTimeoutMs);
        if (item === undefined) return undefined;
    }
    const before = deps.pages().length;
    await clickSelector(deps.entry, item, deps.stepTimeoutMs);
    return followNewPage(deps.pages, before, deps.stepTimeoutMs);
}

/**
 * Refuse to type into the wrong editor: every mode's route carries `createType=<N>` (§2), so an
 * observed mismatch fails loud. A route that carries no `createType` at all (the platform rewrote it)
 * is recorded as unverified rather than guessed at.
 */
function assertEditorMode(editor: WechatPage, operation: WechatmpOperation, path: 'menu' | 'route'): ModeEntry {
    const expected = CREATE_TYPES[operation];
    const createType = readCreateType(editor.url());
    if (createType !== undefined && createType !== expected) {
        throw new Error(
            `mode entry: the editor landed on createType=${createType} but ${operation} is createType=${expected} — refusing to type into another mode's editor (${editor.url()})`,
        );
    }
    return { editor, path, createType: createType ?? null };
}

/**
 * Enter one mode. Primary path: the console's own creation menu, following the tab it opens. When
 * that menu offers no item (drift, or an account type that hides it), the flow derives the editor
 * route from the console's session token and deep-links it — the route template is verified for all
 * four types (§2), while a *stored* editor URL is not reusable (§1/W2).
 */
async function enterMode(deps: ModeRunDeps, operation: WechatmpOperation): Promise<ModeEntry> {
    const viaMenu = await enterViaMenu(deps, operation);
    if (viaMenu !== undefined) return assertEditorMode(viaMenu, operation, 'menu');

    const token = await resolveConsoleToken(deps.entry);
    if (token === undefined) {
        throw new Error(
            `mode entry: the console offers no '${operation}' creation item and carries no session token to derive its route — is the console logged in? (${deps.entry.url()})`,
        );
    }
    const editor = await deps.newPage();
    await editor.goto(editorUrl(operation, token), { timeout: deps.stepTimeoutMs });
    return assertEditorMode(editor, operation, 'route');
}

/**
 * Attach the body images through the editor's own image input, in payload order in ONE call.
 * The FIRST attached image is the one the cover panel's 默认首图为封面 rule turns into the cover
 * (§5.2), which is why `metadata.wechatmp.coverPath` is ordered first (`./modes`).
 */
async function attachImages(page: WechatPage, images: string[], deps: ModeRunDeps): Promise<void> {
    const selector = await findAttachedSelector(page, IMAGE_FILE_INPUT, 'image file input', deps.stepTimeoutMs);
    await page.setInputFiles(selector, images);
}

/**
 * Set the title through the ProseMirror block and verify the form mirror.
 *
 * Trap measured in §5.2: filling `textarea#title` alone saves a draft with an EMPTY title — the
 * block is the input and the textarea a hidden mirror. So the flow types into the block, then reads
 * the mirror back: a readable mirror that disagrees is the trap firing, and it fails loud instead of
 * letting an untitled draft through.
 */
async function typeTitle(page: WechatPage, deps: ModeRunDeps): Promise<'absent' | 'mirror-agreed' | 'mirror-unread'> {
    const title = titleOf(deps.content);
    if (title.length === 0) return 'absent';
    const selector = await findSelector(page, TITLE_BLOCK, 'title block', deps.stepTimeoutMs);
    const block = page.locator(selector).first();
    await block.click({ timeout: deps.stepTimeoutMs });
    // Type rather than fill: a synthetic value set does not register in ProseMirror.
    if (typeof block.type === 'function') await block.type(title, { delay: 5 });
    else await block.fill(title);

    const mirror = await readTitleMirror(page);
    if (mirror.observed && mirror.value !== title) {
        throw new Error(
            `title: the title block holds '${title}' but its form mirror textarea#title reads '${mirror.value}' — the mirror is what a save submits, so the draft would be saved without the title (discovery §5.2 trap 1)`,
        );
    }
    return mirror.observed ? 'mirror-agreed' : 'mirror-unread';
}

/** The hidden form mirror's value; `observed: false` when the console does not expose one. */
async function readTitleMirror(page: WechatPage): Promise<{ observed: boolean; value: string }> {
    const found = await trySelectors(page, TITLE_MIRROR, { visible: false }).catch(() => ({
        found: false,
        selector: null,
    }));
    if (!found.found || !found.selector) return { observed: false, value: '' };
    const locator = page.locator(found.selector).first();
    if (typeof locator.inputValue !== 'function') return { observed: false, value: '' };
    try {
        return { observed: true, value: await locator.inputValue() };
    } catch {
        return { observed: false, value: '' };
    }
}

/**
 * Insert the markdown-derived body into the main-frame ProseMirror editor through the shared paste
 * helper (ADR-029 rail). The retired iframe UEditor and its `setInnerHtml` were the drift this
 * replaces (W1): the body only registers on a real paste, which is what `pasteHtml` sends.
 */
async function insertBody(page: WechatPage, deps: ModeRunDeps): Promise<void> {
    const body = bodyOf(deps.content);
    if (body.trim().length === 0) return;
    const selector = await findSelector(page, BODY_BLOCK, 'article body', deps.stepTimeoutMs);
    await pasteHtml(asPlaywrightPage(page), selector, markdownToWechatHtml(body), { timeoutMs: deps.stepTimeoutMs });
}

/**
 * The current UEditor build keeps the layout choices as nested, unlabelled divs rather than
 * role/menuitem nodes. Playwright's visibility probe rejects those descendants even while the
 * popup is visibly open, so the measured DOM click is kept in a page-side seam and requires one
 * uniquely named target. No arbitrary first-match click is safe here.
 */
function nativeLayoutTargetScript(): string {
    return `/* ${LAYOUT_TARGET_MARKER} */ (() => {
        const popups = [...document.querySelectorAll('.edui-popup')].filter((popup) => {
            const rect = popup.getBoundingClientRect();
            const style = getComputedStyle(popup);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
        const targets = popups
            .flatMap((popup) => [...popup.querySelectorAll('.edui-pastecontainer > .edui-button > div')])
            .filter((candidate) => candidate.textContent?.trim() === '匹配目标格式');
        if (targets.length !== 1) return JSON.stringify({ state: targets.length === 0 ? 'missing' : 'ambiguous' });
        const target = targets[0];
        if (!(target instanceof HTMLElement)) return JSON.stringify({ state: 'missing' });
        target.click();
        return JSON.stringify({ state: 'clicked' });
    })()`;
}

/** The measured editor autosave rail: it is the native completion acknowledgement for layout. */
function nativeLayoutSaveStateScript(): string {
    return `/* ${LAYOUT_SAVE_STATE_MARKER} */ (() => {
        const container = document.querySelector('#auto_save_container');
        if (!container) return 'unknown';
        if (container.textContent?.includes('自动保存中')) return 'saving';
        if (container.querySelector('.save_done')?.textContent?.includes('已保存')) return 'saved';
        return 'unknown';
    })()`;
}

/**
 * The legacy `media/appmsg_edit` editor has no active v2 autosave rail. Its measured manual-save
 * readiness is narrower: the canonical route is explicit, the v2 container is empty, the legacy
 * autosave and save-success markers exist but are hidden, and exactly one visible 保存为草稿 control
 * remains. Unknown DOM shapes stay unknown; they are never treated as idle.
 */
function nativeLegacyEditorReadyScript(): string {
    return `/* ${LEGACY_EDITOR_READY_MARKER} */ (() => {
        const current = new URL(window.location.href);
        const canonicalLegacyRoute =
            current.origin === 'https://mp.weixin.qq.com' &&
            current.pathname === '/cgi-bin/appmsg' &&
            current.searchParams.get('t') === 'media/appmsg_edit' &&
            current.searchParams.get('action') === 'edit' &&
            (current.searchParams.get('appmsgid') ?? '').trim() !== '' &&
            current.searchParams.get('isNew') !== '1';
        if (!canonicalLegacyRoute) return 'unknown';
        const autoSaveContainer = document.querySelector('#auto_save_container');
        const legacyAutoSave = document.querySelector('#js_autosave');
        const saveSuccessMarkers = [...document.querySelectorAll(
            '#js_save_success, #js_save_success_with_ad, #js_save_success_with_ad_op',
        )];
        if (!autoSaveContainer || !legacyAutoSave || saveSuccessMarkers.length === 0) return 'unknown';
        const hidden = (node) => {
            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0;
        };
        const visibleSaveControls = [...document.querySelectorAll('button, a')].filter((node) => {
            const text = (node.textContent ?? '').replace(/[\\s\\u00a0]+/g, '').trim();
            if (text !== '保存为草稿') return false;
            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        });
        return autoSaveContainer.textContent?.trim() === '' &&
            hidden(legacyAutoSave) &&
            saveSuccessMarkers.every(hidden) &&
            visibleSaveControls.length === 1
            ? 'ready'
            : 'unknown';
    })()`;
}

async function clickNativeLayoutTarget(page: WechatPage, deps: ModeRunDeps): Promise<boolean> {
    let state: string = 'missing';
    const observed = await waitUntil(
        async () => {
            const raw = await page.evaluate(nativeLayoutTargetScript()).catch(() => null);
            if (typeof raw !== 'string') return false;
            try {
                const parsed = JSON.parse(raw) as { state?: string };
                if (parsed.state === 'ambiguous') {
                    state = 'ambiguous';
                    return true;
                }
                if (parsed.state === 'clicked') {
                    state = 'clicked';
                    return true;
                }
            } catch {
                state = 'missing';
            }
            return false;
        },
        Math.min(deps.stepTimeoutMs, 5_000),
        deps.pollMs,
    );
    if (!observed) return false;
    if (state === 'ambiguous')
        throw new Error(
            '一键排版: 匹配目标格式 was ambiguous in the visible native menu — composition stopped before submission',
        );
    return state === 'clicked';
}

async function waitForNativeLayoutSave(page: WechatPage, deps: ModeRunDeps): Promise<void> {
    let sawSaving = false;
    const saved = await waitUntil(
        async () => {
            const state = await page.evaluate(nativeLayoutSaveStateScript()).catch(() => 'unknown');
            if (state === 'saving') sawSaving = true;
            return sawSaving && state === 'saved';
        },
        Math.min(deps.stepTimeoutMs, 15_000),
        deps.pollMs,
    );
    if (!saved)
        throw new Error(
            '一键排版: native auto-save did not transition from 自动保存中... to 已保存 within the layout deadline — composition stopped before submission',
        );
}

/**
 * `一键排版` applies the platform's own layout to the pasted body. The operator walk of 2026-10-10 shows
 * the control is present and expected to be applied, so a click that leads nowhere is now rejected
 * rather than swallowed (the earlier version failed silently, which is why 正文 came out unformatted).
 *
 * The format set (`保留源格式` / `匹配目标格式` / `仅保留文本`) is what we want when it renders as a menu;
 * `匹配目标格式` is the correct choice for markdown-derived content. A build where the trio is only a
 * label (the 2026-10-05 dogfood reading) is accepted only when its own measured commit signal is
 * available; an unrecognized control fails closed before submission.
 */
async function applyLayout(page: WechatPage, deps: ModeRunDeps): Promise<string | null> {
    // Measured 2026-10-13: the current editor build exposes no 一键排版 control at all. An absent
    // control is the platform's layout — silently skip; only a found-but-failing control warns.
    const control = await tryFindSelector(page, LAYOUT_CONTROL, Math.min(deps.stepTimeoutMs, 5_000));
    if (control === undefined) return null;
    const before = deps.pages().length;
    try {
        await clickSelector(page, control, deps.stepTimeoutMs);
    } catch (error) {
        return `一键排版: click failed — ${error instanceof Error ? error.message : String(error)}`;
    }
    if (await clickNativeLayoutTarget(page, deps)) {
        await waitForNativeLayoutSave(page, deps);
        return null;
    }
    let layoutPage = page;
    let option: string | undefined;
    await waitUntil(
        async () => {
            for (const candidate of [...deps.pages().slice(before), page]) {
                const found = await trySelectors(candidate, [...LAYOUT_PREVIEW_APPLY, ...LAYOUT_TARGET]);
                if (found.found && found.selector) {
                    layoutPage = candidate;
                    option = found.selector;
                    return true;
                }
            }
            return false;
        },
        Math.min(deps.stepTimeoutMs, 15_000),
    );
    if (option !== undefined && LAYOUT_PREVIEW_APPLY.includes(option)) {
        const selected = option;
        await clickSelector(layoutPage, selected, deps.stepTimeoutMs);
        const closed = await waitUntil(
            async () => {
                if (!deps.pages().includes(layoutPage)) return true;
                const control = layoutPage.locator(selected).first();
                return !(await control.isVisible());
            },
            Math.min(deps.stepTimeoutMs, 5_000),
        );
        if (!closed)
            throw new Error('一键排版: 使用此排版 did not close the preview — composition stopped before submission');
        return null;
    }
    if (option === undefined) {
        if (deps.pages().length > before)
            throw new Error(
                '一键排版: a new preview tab opened without a recognized commit action — composition stopped before submission',
            );
        throw new Error(
            '一键排版: the visible control exposed no recognized commit action — composition stopped before submission',
        );
    }
    try {
        await clickSelector(layoutPage, option, 5_000);
        return null;
    } catch (error) {
        return `一键排版: 匹配目标格式 not applied — ${error instanceof Error ? error.message : String(error)}`;
    }
}

/** Fill an optional field, recording a warning instead of failing the run. */
async function fillOptional(
    page: WechatPage,
    selectors: readonly string[],
    value: string,
    what: string,
    deps: ModeRunDeps,
): Promise<string | null> {
    if (value.length === 0) return null;
    const selector = await tryFindSelector(page, selectors, Math.min(deps.stepTimeoutMs, 5_000));
    if (selector === undefined) return `optional field '${what}': none of [${selectors.join(' | ')}] visible`;
    try {
        await fillSelector(page, selector, value);
        return null;
    } catch (error) {
        // The console hides some fields for some account types; the setting stays manual.
        return `optional field '${what}': ${error instanceof Error ? error.message : String(error)}`;
    }
}

/** Local path basename — the only piece of a requested file a remote asset could ever expose. */
function baseName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
}

/** A stable name binds the library choice to these cover bytes across interrupted retries. */
async function coverLibraryName(path: string): Promise<string> {
    if (!(await Bun.file(path).exists())) return baseName(path);
    const hash = new Bun.CryptoHasher('sha256')
        .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
        .digest('hex');
    return `kk-cover-${hash.slice(0, 32)}${extname(path).toLowerCase()}`;
}

function coverAssetIdentity(value: string): string {
    try {
        const url = new URL(value);
        return url.hostname === 'mmbiz.qpic.cn'
            ? `${url.hostname}${url.pathname.replace(/\/(?:0|300|640|1080)$/, '')}`
            : value;
    } catch {
        return value;
    }
}

/** The identities `setCover` can accept for a candidate: the requested article image and/or the
 *  upload binding actually observed going into the audio form. Either is optional; at least one
 *  must produce a UNIQUE exposed match before anything is clicked (task 0260 R1). */
interface CoverIdentity {
    /** `coverPath(input)` — the article's first body image, requested as the cover. */
    requested?: string;
    /** The cover file the audio upload just bound into the form/library (when audio ran). */
    binding?: string;
}

/**
 * 封面 (§5.2): there is no cover file input. `从图片库选择` picks the episode cover, `从正文选择`
 * the first body image. A candidate is identified ONLY by an exposed exact filename (`title` /
 * `data-name` / its own filename text) uniquely equal to one of the requested identities; a miss or
 * an ambiguity warns WITHOUT clicking first/newest. After the confirm, the committed preview under
 * `#js_cover_area` is read back: the empty state (`add_cover` icon still visible) or an unreadable
 * preview is a named warning, never a success claim (task 0260 R1).
 */
export async function setCover(
    page: WechatPage,
    source: 'library' | 'body',
    deps: Pick<ModeRunDeps, 'stepTimeoutMs'>,
    identity: CoverIdentity,
): Promise<string | null> {
    const picker = source === 'library' ? COVER_FROM_LIBRARY : COVER_FROM_CONTENT;
    const what = source === 'library' ? '从图片库选择' : '从正文选择';
    const wanted = [
        ...(identity.requested ? [baseName(identity.requested)] : []),
        ...(identity.binding ? [baseName(identity.binding)] : []),
    ]
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
    // A cover miss is a warning, never a gate — so the panel must not outlive the step that opened
    // it (see {@link dismissOpenDialog} for what its footer blocked on 2026-10-12).
    const warn = async (message: string): Promise<string> => {
        const inventory = await openDialogInventory(page);
        await dismissOpenDialog(page);
        return inventory ? `${message} (dialogs: ${inventory})` : message;
    };
    try {
        const open = await tryFindSelector(page, COVER_PANEL_OPEN, Math.min(deps.stepTimeoutMs, 5_000));
        if (open === undefined)
            return await warn(
                'cover: the panel offers none of 从正文选择 / 从图片库选择 — the platform default (默认首图为封面) is all this run has',
            );
        await clickSelector(page, open, deps.stepTimeoutMs);
        const alreadyOpen =
            source === 'library' &&
            (await tryFindSelector(
                page,
                ['.weui-desktop-dialog:visible:has(h3:has-text("选择图片"))'],
                Math.min(deps.stepTimeoutMs, 1_000),
            )) !== undefined;
        if (!alreadyOpen) {
            const pick = await tryFindSelector(page, picker, Math.min(deps.stepTimeoutMs, 8_000));
            if (pick === undefined) return await warn(`cover: ${what} was not offered by the open cover panel`);
            await clickSelector(page, pick, deps.stepTimeoutMs);
        }
        if (wanted.length === 0)
            return await warn(`cover: no requested cover file identity to match against — ${what} not driven`);
        // Identify before clicking: the item list is not <img>-based (§5.2) and never sorted the way
        // a first-item assumption needs, so the only honest pick is an exposed unique exact name.
        const IDENTIFY = `(() => {
            const wanted = ${JSON.stringify(wanted)};
            const rows = [...document.querySelectorAll('.weui-desktop-img-picker__item, div[class*="img_picker" i] li, div[class*="imgList" i] li, div[class*="cover" i] li')]
                .filter((row) => row.offsetWidth > 0);
            const nameOf = (row) => {
                const el = row.querySelector('[title], [data-name], [data-file_name]') ?? row;
                const attrs = [el.getAttribute?.('title'), el.getAttribute?.('data-name'), el.getAttribute?.('data-file_name')];
                const text = [...row.querySelectorAll('[class*="name" i], [class*="title" i]')].map((n) => n.textContent ?? '');
                return [...attrs, ...text].map((v) => (v ?? '').trim()).filter((v) => v.length > 0);
            };
            const hits = rows.filter((row) => wanted.some((w) => nameOf(row).includes(w)));
            if (hits.length === 0) return 'missing';
            if (hits.length > 1) return 'ambiguous';
            const row = hits[0];
            if (!row.classList.contains('selected')) row.click();
            const checked = row.querySelector('input[type=checkbox], [role=checkbox]');
            const css = row.querySelector('[style*="background-image"]')?.style.backgroundImage ?? '';
            const backgroundUrl = css.startsWith('url("') || css.startsWith("url('") ? css.slice(5, -2) : css.startsWith('url(') ? css.slice(4, -1) : '';
            const src = row.querySelector('img')?.src || backgroundUrl;
            return JSON.stringify({ picked: true, src });
        })()`;
        let rawIdentify = 'missing';
        await waitUntil(
            async () => {
                rawIdentify = String(await page.evaluate(IDENTIFY));
                return rawIdentify !== 'missing';
            },
            Math.min(deps.stepTimeoutMs, 8_000),
        );
        const paginationScript = `(() => {
            const dialog = [...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetWidth > 0 && d.querySelector('h3')?.textContent?.includes('选择图片'));
            const labels = dialog?.querySelectorAll('.weui-desktop-pagination__num');
            return JSON.stringify({ page: Number(labels?.[0]?.textContent ?? 0), total: Number(labels?.[1]?.textContent ?? 0) });
        })()`;
        for (let scanned = 0; source === 'library' && rawIdentify === 'missing' && scanned < 50; scanned += 1) {
            const pagination = JSON.parse(String(await page.evaluate(paginationScript))) as {
                page?: number;
                total?: number;
            } | null;
            if (!(Number(pagination?.page) > 0 && Number(pagination?.page) < Number(pagination?.total))) break;
            const nextPage = await tryFindSelector(
                page,
                [
                    '.weui-desktop-dialog:visible:has(h3:has-text("选择图片")) a:has-text("下一页"):visible:not(.weui-desktop-btn_disabled)',
                ],
                1_000,
            );
            if (nextPage === undefined) break;
            await clickSelector(page, nextPage, deps.stepTimeoutMs);
            await page.waitForTimeout?.(500);
            await waitUntil(
                async () =>
                    Boolean(
                        await page.evaluate(
                            `![...document.querySelectorAll('.weui-desktop-dialog .weui-desktop-loading')].some(node => node.offsetWidth > 0)`,
                        ),
                    ),
                Math.min(deps.stepTimeoutMs, 8_000),
            );
            rawIdentify = String(await page.evaluate(IDENTIFY));
        }
        if (rawIdentify === 'missing')
            return await warn(`cover: ${what} 未标出与请求文件同名的素材，未选择（不按首图猜测）`);
        if (rawIdentify === 'ambiguous') return await warn(`cover: ${what} 匹配到多个同名素材，身份不唯一，未选择`);
        let selected: { picked?: boolean; src?: string } = {};
        try {
            selected = JSON.parse(rawIdentify) as { picked?: boolean; src?: string };
        } catch {
            return await warn('cover: 素材身份探测返回未知结果，未选择');
        }
        // The library picker stages the choice: 下一步 advances it, then the dialog confirms.
        const next = await tryFindSelector(page, COVER_LIBRARY_NEXT, Math.min(deps.stepTimeoutMs, 4_000));
        if (next !== undefined) await clickSelector(page, next, deps.stepTimeoutMs);
        const confirm = await tryFindSelector(page, COVER_CONFIRM, Math.min(deps.stepTimeoutMs, 8_000));
        if (confirm === undefined) return await warn('cover: the choice panel offered no confirm control');
        const selectedSrc = (selected.src ?? '').trim();
        const cropSources: unknown = JSON.parse(
            String(
                await page.evaluate(`(() => {
            const dialog = [...document.querySelectorAll('.weui-desktop-dialog')].find(d => d.offsetWidth > 0 && d.querySelector('h3')?.textContent?.trim() === '编辑封面');
            return JSON.stringify([...(dialog?.querySelectorAll('img.crop-img') ?? [])]
                .filter(img => img.offsetWidth > 0 && getComputedStyle(img).visibility !== 'hidden').map(img => img.src));
        })()`),
            ),
        );
        const cropBound =
            selectedSrc !== '' &&
            Array.isArray(cropSources) &&
            cropSources.some(
                (src) => typeof src === 'string' && coverAssetIdentity(src) === coverAssetIdentity(selectedSrc),
            );
        const beforeCommit = String(
            await page.evaluate(`(() => {
            const css = document.querySelector('#js_cover_area .js_cover_preview_new')?.style.backgroundImage ?? '';
            return css.startsWith('url("') || css.startsWith("url('") ? css.slice(5, -2) : css.startsWith('url(') ? css.slice(4, -1) : '';
        })()`),
        );
        await clickSelector(page, confirm, deps.stepTimeoutMs);
        // Committed readback (observed capture: the preview lives under #js_cover_area; the empty
        // state keeps the `add_cover` icon visible). Poll briefly — the preview renders late.
        const READBACK = `(() => {
            const area = document.querySelector('#js_cover_area');
            if (!area) return 'noarea';
            const preview = area.querySelector('.js_cover_preview_new');
            if (!preview || preview.offsetWidth === 0) {
                return area.querySelector('.icon20_common.add_cover')?.offsetWidth > 0 ? 'empty' : 'nopreview';
            }
            const css = preview.style.backgroundImage || preview.querySelector('[style*="background-image"]')?.style.backgroundImage || '';
            const backgroundUrl = css.startsWith('url("') || css.startsWith("url('") ? css.slice(5, -2) : css.startsWith('url(') ? css.slice(4, -1) : '';
            const src = preview.querySelector('img')?.src || backgroundUrl || preview.querySelector('input[type=hidden]')?.value || '';
            return src ? src : 'unknown';
        })()`;
        let committed = '';
        let lastRead = '';
        const observed = await waitUntil(
            async () => {
                lastRead = String(await page.evaluate(READBACK).catch(() => 'error'));
                if (['', 'nopreview', 'noarea', 'empty', 'unknown', 'error'].includes(lastRead)) return false;
                if (
                    cropBound &&
                    lastRead === beforeCommit &&
                    coverAssetIdentity(lastRead) !== coverAssetIdentity(selectedSrc)
                )
                    return false;
                committed = lastRead;
                return true;
            },
            Math.min(deps.stepTimeoutMs, 15_000),
            200,
        );
        if (!observed)
            return await warn(
                lastRead === 'empty'
                    ? 'cover: 确认后面板仍显示未设置封面，提交未生效'
                    : 'cover: 已确认但无法读取已提交封面，请手动核对',
            );
        // Identity comparison: both sides are remote asset references from the same widget. Only an
        // exact match proves the requested asset committed; an unreadable/edited preview warns
        // rather than inventing equivalence (local paths are never compared to asset URLs).
        let derivedFromBoundCrop = false;
        try {
            const url = new URL(committed);
            derivedFromBoundCrop =
                cropBound &&
                committed !== beforeCommit &&
                url.hostname === 'mmbiz.qpic.cn' &&
                ['http:', 'https:'].includes(url.protocol);
        } catch {
            /* Unknown preview references stay unverifiable. */
        }
        if (
            selectedSrc === '' ||
            (coverAssetIdentity(committed) !== coverAssetIdentity(selectedSrc) && !derivedFromBoundCrop)
        )
            return await warn(
                `cover: 已提交封面的素材身份与所选不一致（selected=${selectedSrc || '未读到'} committed=${committed.slice(0, 80)}）`,
            );
        return null;
    } catch (error) {
        return await warn(`cover: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** `metadata.wechatmp.coverSource` — `library` (default) is the uploaded episode cover. */
function coverSourceOf(content: Content): 'library' | 'body' {
    const meta = content.metadata?.wechatmp;
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return 'library';
    return (meta as Record<string, unknown>).coverSource === 'body' ? 'body' : 'library';
}

/** The audio-embed block of `metadata.wechatmp`, or null when this run embeds no audio. Shared by
 *  the cover step (the library only holds the episode cover once audio uploaded — task 0272). */
function audioBlockOf(content: Content): { title: string; audioPath: string; coverPath: string } | null {
    const meta = content.metadata?.wechatmp;
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return null;
    const m = meta as Record<string, unknown>;
    if (
        typeof m.audioTitle !== 'string' ||
        m.audioTitle.trim() === '' ||
        typeof m.audioPath !== 'string' ||
        m.audioPath === ''
    )
        return null;
    return {
        title: m.audioTitle.trim(),
        audioPath: m.audioPath,
        coverPath: typeof m.audioCoverPath === 'string' ? m.audioCoverPath : '',
    };
}

/** 文章's `metadata.wechatmp` enrichment rail, plus its opt-in audio embed (2026-09-29, ADR-026). */
async function enrichArticleDraft(
    page: WechatPage,
    content: Content,
    stepTimeoutMs: number,
): Promise<{ enrichWarnings: string[]; coverWarnings: string[] }> {
    const enrichMeta = content.metadata?.wechatmp;
    if (enrichMeta === undefined || typeof enrichMeta !== 'object' || Array.isArray(enrichMeta))
        return { enrichWarnings: [], coverWarnings: [] };
    const meta = enrichMeta as Record<string, unknown>;
    const enrichWarnings = await enrichArticle(page, meta);
    const audio = audioBlockOf(content);
    let audioFailed = false;
    if (audio !== null) {
        const audioWarning = await insertAudioMaterial(page, audio);
        if (audioWarning !== '') {
            enrichWarnings.push(audioWarning);
            audioFailed = true;
        }
    }
    // Deferred library cover (task 0272): the audio upload just put the episode cover in the 图片库 —
    // but ONLY a committed upload guarantees that (task 0260 R1: a failed/uncertain audio upload
    // leaves the library without the requested cover, so the dependent picker must not run).
    const coverWarnings: string[] = [];
    if (coverSourceOf(content) === 'library' && audio !== null) {
        if (audioFailed) {
            coverWarnings.push('cover: 音频上传未成功，图片库不保证已有请求封面，已跳过图片库封面');
        } else {
            const cover = await setCover(
                page,
                'library',
                { stepTimeoutMs: Math.min(stepTimeoutMs, 8_000) },
                // The upload binding is the image the audio form just bound (the episode cover
                // file); `coverPath(input)` is the article's own first body image, not this.
                { binding: audio.coverPath === '' ? undefined : await coverLibraryName(audio.coverPath) },
            );
            if (cover !== null) coverWarnings.push(cover);
        }
    }
    return { enrichWarnings, coverWarnings };
}

/** Compose 文章 (createType 0): body images, title, body + 一键排版, 摘要, 作者, cover, settings. */
async function composeArticle(
    input: { operation: '文章'; images: string[]; digest?: string },
    deps: ModeRunDeps,
    entry: ModeEntry,
): Promise<ComposeReport> {
    const page = entry.editor;
    const warnings: string[] = [];
    await attachImages(page, input.images, deps);
    const titlePath = await typeTitle(page, deps);
    await insertBody(page, deps);
    for (const warning of [
        await fillOptional(page, DIGEST_INPUT, input.digest ?? '', '摘要', deps),
        await fillOptional(page, AUTHOR_INPUT, authorOf(deps.content), '作者', deps),
    ]) {
        if (warning !== null) warnings.push(warning);
    }
    const coverSource = coverSourceOf(deps.content);
    const audioRuns = audioBlockOf(deps.content) !== null;
    if (!(coverSource === 'library' && audioRuns)) {
        const cover = await setCover(page, coverSource, deps, {
            // Requested identity = the article's first body image (the 默认首图为封面 semantics of
            // modes.coverPath). No audio ran, so the library binding is unknown — only an exposed
            // exact filename can match.
            requested: input.images[0],
        });
        if (cover !== null) warnings.push(cover);
    }
    const { enrichWarnings, coverWarnings } = await enrichArticleDraft(page, deps.content, deps.stepTimeoutMs);
    warnings.push(...coverWarnings);
    // Layout is deliberately last: 原文链接, media insertion, and cover commitment must be part of
    // the body the platform formats, and the native auto-save acknowledgement must settle before
    // 保存为草稿 or the public saved-editor readback begins.
    const layout = await applyLayout(page, deps);
    if (layout !== null) warnings.push(layout);
    return { warnings, titlePath, enrichWarnings };
}

/** Compose 贴图 (createType 8): ≥1 image is the message; title and body are 选填. */
async function composeSticker(
    input: { operation: '贴图'; images: string[] },
    deps: ModeRunDeps,
    entry: ModeEntry,
): Promise<ComposeReport> {
    const page = entry.editor;
    await attachImages(page, input.images, deps);
    const titlePath = await typeTitle(page, deps);
    await insertBody(page, deps);
    return { warnings: [], titlePath, enrichWarnings: [] };
}

/**
 * Compose 视频 (createType 5). The media modal COVERS the save bar (§5.1), so the artifact is
 * attached first and the bar's appearance is the proof it landed; a missing artifact never reaches
 * here (it fails before the browser opens).
 */
async function composeVideo(
    input: { operation: '视频'; video: string },
    deps: ModeRunDeps,
    entry: ModeEntry,
): Promise<ComposeReport> {
    const page = entry.editor;
    const upload = await findSelector(page, VIDEO_LOCAL_UPLOAD, '本地上传 control', deps.stepTimeoutMs);
    await clickSelector(page, upload, deps.stepTimeoutMs);
    const fileInput = await findAttachedSelector(page, VIDEO_FILE_INPUT, 'video file input', deps.stepTimeoutMs);
    await uploadFile(asPlaywrightPage(page), fileInput, input.video, { timeoutMs: deps.stepTimeoutMs });
    const confirm = await findSelector(page, VIDEO_CONFIRM, 'video media confirm', deps.stepTimeoutMs);
    await clickSelector(page, confirm, deps.stepTimeoutMs);
    await awaitSaveBar(page, deps);
    const titlePath = await typeTitle(page, deps);
    await insertBody(page, deps);
    return { warnings: [], titlePath, enrichWarnings: [] };
}

/**
 * Compose 播客 (createType 7). The modal needs audio AND a cover (§5.2), and it covers the save bar,
 * so `插入` + the bar's appearance gate every later step.
 */
async function composePodcast(
    input: { operation: '播客'; audio: string; cover: string },
    deps: ModeRunDeps,
    entry: ModeEntry,
): Promise<ComposeReport> {
    const page = entry.editor;
    const upload = await findSelector(page, PODCAST_UPLOAD, '上传音频 control', deps.stepTimeoutMs);
    await clickSelector(page, upload, deps.stepTimeoutMs);
    const audioInput = await findAttachedSelector(page, PODCAST_AUDIO_INPUT, 'audio file input', deps.stepTimeoutMs);
    await uploadFile(asPlaywrightPage(page), audioInput, input.audio, { timeoutMs: deps.stepTimeoutMs });
    const coverInput = await findAttachedSelector(page, PODCAST_COVER_INPUT, 'cover file input', deps.stepTimeoutMs);
    await uploadFile(asPlaywrightPage(page), coverInput, input.cover, { timeoutMs: deps.stepTimeoutMs });
    const insert = await findSelector(page, PODCAST_INSERT, '插入 control', deps.stepTimeoutMs);
    await clickSelector(page, insert, deps.stepTimeoutMs);
    await awaitSaveBar(page, deps);
    const titlePath = await typeTitle(page, deps);
    await insertBody(page, deps);
    return { warnings: [], titlePath, enrichWarnings: [] };
}

/**
 * The save bar exists only once a 视频/播客 artifact is attached (§5.1) — waiting for it is the proof
 * the artifact landed, and it fails loud naming the control when it never appears.
 */
async function awaitSaveBar(page: WechatPage, deps: ModeRunDeps): Promise<void> {
    await findSelector(
        page,
        SAVE_DRAFT,
        '保存为草稿 control (it appears only after the media is attached)',
        deps.stepTimeoutMs,
    );
}

/** What composing one mode reported: warnings, the title route, and the 文章 enrichment warnings. */
interface ComposeReport {
    warnings: string[];
    titlePath: 'absent' | 'mirror-agreed' | 'mirror-unread';
    enrichWarnings: string[];
}

/** Compose the requested mode's post. Exhaustive over {@link ModeInput}. */
async function compose(input: ModeInput, deps: ModeRunDeps, entry: ModeEntry): Promise<ComposeReport> {
    switch (input.operation) {
        case '文章':
            return composeArticle(input, deps, entry);
        case '贴图':
            return composeSticker(input, deps, entry);
        case '视频':
            return composeVideo(input, deps, entry);
        case '播客':
            return composePodcast(input, deps, entry);
    }
}

function authorOf(content: Content): string {
    // The 作者 field is the byline readers see. The daily stage carries it as `metadata.wechatmp.author`
    // (with the other MP preferences); `metadata.author` is the generic Content field and wins when a
    // producer sets it directly. Reading only the generic one left 请输入作者 empty on every daily run
    // (operator report 2026-10-10).
    const wechatmp = content.metadata?.wechatmp;
    const scoped =
        wechatmp !== null && typeof wechatmp === 'object' && !Array.isArray(wechatmp)
            ? (wechatmp as Record<string, unknown>).author
            : undefined;
    const generic = content.metadata?.author;
    if (typeof generic === 'string' && generic.trim() !== '') return generic.trim();
    return typeof scoped === 'string' ? scoped.trim() : '';
}

function baseMetadata(input: ModeInput, deps: ModeRunDeps, entry: ModeEntry): Record<string, unknown> {
    const cover = coverPath(input);
    return {
        operation: input.operation,
        driver: deps.driver,
        publishStatus: deps.publishStatus,
        profileDir: deps.profileDir,
        artifactPaths: artifactPaths(input),
        entryPath: entry.path,
        editorCreateType: entry.createType,
        editorUrl: sanitizeSessionEvidence(entry.editor.url()),
        ...(cover === undefined ? {} : { coverPath: cover }),
    };
}

/**
 * Save as a draft: settle, click `保存为草稿`, then require an OBSERVED signal.
 *
 * The signal is the 草稿箱 row's `更新于` stamp for this title, observed FRESH — different from the
 * baseline read before the editor opened (MP auto-saves continuously, so a row that already existed
 * says nothing about this save, §5.1). The click is retried (the console drops one that lands while
 * the editor is still settling), but the signal is never assumed: an unobserved save is `ok:false`
 * naming the control, the title and the deadline. `发表` is not clicked on this path at all.
 */
async function saveDraft(
    input: ModeInput,
    deps: ModeRunDeps,
    entry: ModeEntry,
    composed: ComposeReport,
): Promise<Result> {
    const title = titleOf(deps.content);
    let control: string | null = null;
    let signal: string | null = null;
    let attempts = 0;
    let residuals = 0;
    const residualDialogs: string[] = [];
    let stampAfter: string | null = deps.draftBaseline.stamp;
    while (signal === null && attempts < deps.submitAttempts) {
        attempts += 1;
        await sleep(deps.submitSettleMs);
        if ((await closeOpenDialogs(entry.editor)) !== 'closed') {
            residuals += 1;
            residualDialogs.push(await openDialogInventory(entry.editor).catch(() => 'unreadable'));
            // Refuse to click through an unresolved overlay (0260 R3/AC5): the click would land on
            // the dialog footer again, not 保存为草稿. Retry the cleanup on the next attempt.
            if (attempts < deps.submitAttempts) continue;
            break;
        }
        control = await findSelector(entry.editor, SAVE_DRAFT, '保存为草稿 control', deps.stepTimeoutMs);
        await clickSelector(entry.editor, control, deps.stepTimeoutMs);
        // The editor lives in its own tab, so re-read the console entry page — and ENTER the 草稿箱
        // list first, because the home page does not render the draft rows (live 2026-10-05).
        await deps.entry.goto(deps.entry.url(), { timeout: deps.stepTimeoutMs });
        await openDraftBox(deps.entry, title, deps.stepTimeoutMs, deps.pollMs);
        const outcome = await expectOutcome(
            async () => {
                const stamp = await readDraftStamp(deps.entry, title);
                stampAfter = stamp;
                return stamp !== null && stamp !== deps.draftBaseline.stamp ? stamp : null;
            },
            {
                timeoutMs: deps.draftTimeoutMs,
                label: `draft confirmation '${control}'`,
                pollMs: deps.pollMs,
            },
        );
        if (outcome.ok) signal = outcome.evidence;
    }

    if (signal === null || control === null) {
        if (control === null)
            return fail(
                `draft confirmation: a residual modal refused cleanup after ${attempts} attempt(s), ${residuals} refused cleanup(s) (${residualDialogs.join(' | ') || 'no inventory'}) — '保存为草稿' was not clicked through an unresolved overlay (inventory: ${await openDialogInventory(entry.editor).catch(() => 'unreadable')})`,
            );
        return fail(
            `draft confirmation: '${SAVE_DRAFT[0]}' was clicked ${attempts}× but no fresh 草稿箱 row for '${title}' (its ${DRAFT_STAMP} stamp) was observed within ${deps.draftTimeoutMs}ms (before=${deps.draftBaseline.stamp ?? 'none'}, after=${stampAfter ?? 'none'}, page=${deps.entry.url()}, frames=${await describeFrames(deps.entry, 5)})`,
        );
    }
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        message: `${TARGET} ${input.operation} draft saved (unpublished) in profile ${deps.profileDir} via '${control}'`,
        metadata: {
            ...baseMetadata(input, deps, entry),
            draftControl: control,
            draftAttempts: attempts,
            draftSignal: `草稿箱:${signal}`,
            draftStampBefore: deps.draftBaseline.stamp,
            draftStampAfter: signal,
            titlePath: composed.titlePath,
            ...(residuals > 0
                ? {
                      warnings: [
                          `保存前清理了 ${residuals} 个残留弹层（${residualDialogs.join(' | ')}），草稿仍保存成功`,
                      ],
                  }
                : {}),
            ...(composed.warnings.length > 0 ? { warnings: composed.warnings } : {}),
            ...(composed.enrichWarnings.length > 0 ? { enrichWarnings: composed.enrichWarnings } : {}),
        },
    });
}

interface PublicDraftSnapshot {
    title: string;
    body: string;
    media: string[];
    cover: string;
    originalUrl: string;
}

interface PublicSaveEvidence {
    saveControl: string;
    canonicalUrl: string;
    canonicalUrlForMetadata: string;
    saveSignal: 'canonical-url-transition+snapshot' | 'persisted-snapshot';
    snapshot: PublicDraftSnapshot;
}

/**
 * The public rail's only native saved-editor readiness signal is the URL the console assigns after
 * `保存为草稿`: an existing appmsg with a concrete `appmsgid` and the editor action. The live
 * console's saved URL omits `isNew` (the CGI draft route may include `isNew=0`), while `isNew=1`
 * is still the unsaved editor and must be rejected. The old home 草稿箱 card is deliberately not
 * used here — the live console has rendered that card on a different surface from the editor, and a
 * row cannot prove that this editor is the latest version.
 */
function canonicalSavedEditorUrl(value: string): string | null {
    try {
        const url = new URL(value);
        if (url.origin !== 'https://mp.weixin.qq.com' || url.pathname !== '/cgi-bin/appmsg') return null;
        if (url.searchParams.get('action') !== 'edit' || url.searchParams.get('isNew') === '1') return null;
        if ((url.searchParams.get('appmsgid') ?? '').trim() === '') return null;
        return url.toString();
    } catch {
        return null;
    }
}

/** Keep the navigation URL private while retaining a useful, credential-free receipt value. */
function savedEditorUrlForMetadata(value: string): string {
    return sanitizeSessionEvidence(value);
}

/** A read-only DOM snapshot used to prove the saved editor still contains the composed payload. */
const PUBLIC_DRAFT_SNAPSHOT_SCRIPT = `/* __KK_WECHAT_PUBLISH_SNAPSHOT__ */ (() => {
    const norm = (value) => (value ?? '').replace(/[\\s\\u00a0]+/g, ' ').trim();
    const titleNode = document.querySelector('textarea#title, textarea.js_title');
    const title = titleNode?.value ?? [...document.querySelectorAll('.ProseMirror[data-placeholder*="标题"]')]
        .map((node) => node.textContent ?? '').join(' ');
    const body = [...document.querySelectorAll('.ProseMirror:not([data-placeholder])')]
        .map((node) => norm(node.textContent)).join('\\n');
    const media = [
        ...document.querySelectorAll(
            '.ProseMirror mp-common-mpaudio, .ProseMirror mpvoice, .ProseMirror [data-mediaid], .ProseMirror audio, .ProseMirror video, .ProseMirror img',
        ),
    ]
        .map((node) => node.getAttribute('data-mediaid') ?? node.getAttribute('data-id') ??
            node.getAttribute('voice_encode_fileid') ?? node.getAttribute('data-src') ?? node.getAttribute('src') ??
            norm(node.textContent))
        .map(norm).filter((value) => value.length > 0);
    const area = document.querySelector('#js_cover_area');
    const coverNode = area?.querySelector('.js_cover_preview_new img, img, [style*="background-image"], input[type="hidden"]');
    const cover = coverNode?.getAttribute('src') ?? coverNode?.getAttribute('value') ??
        coverNode?.style.backgroundImage ?? '';
    const urlArea = document.querySelector('#js_article_url_area');
    const originalUrl = urlArea?.querySelector('input.js_url_checkbox')?.checked === true
        ? norm(urlArea.querySelector('.article_url_setting')?.textContent) : '';
    return JSON.stringify({ title: norm(title), body, media, cover: norm(cover), originalUrl });
})()`;

function normalizeSnapshotText(value: string): string {
    return value.replace(/[\s\u00a0]+/g, ' ').trim();
}

/** Read only the known title/body/media/cover surfaces; unreadable evidence is never treated as equal. */
async function readPublicDraftSnapshot(page: WechatPage): Promise<PublicDraftSnapshot | null> {
    try {
        const raw = await page.evaluate(PUBLIC_DRAFT_SNAPSHOT_SCRIPT);
        const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        const value = parsed as Record<string, unknown>;
        if (
            typeof value.title !== 'string' ||
            typeof value.body !== 'string' ||
            !Array.isArray(value.media) ||
            value.media.some((item) => typeof item !== 'string') ||
            typeof value.cover !== 'string'
        )
            return null;
        return {
            title: normalizeSnapshotText(value.title),
            body: normalizeSnapshotText(value.body),
            media: value.media.map((item) => normalizeSnapshotText(item)),
            cover: normalizeSnapshotText(value.cover),
            originalUrl: typeof value.originalUrl === 'string' ? normalizeSnapshotText(value.originalUrl) : '',
        };
    } catch {
        return null;
    }
}

function publicSnapshotDifferences(before: PublicDraftSnapshot, after: PublicDraftSnapshot): string[] {
    const differences: string[] = [];
    if (before.title !== after.title) differences.push('title');
    if (before.body !== after.body) differences.push('body');
    // WeChat re-encodes/resizes uploaded body images on save. Its CDN preserves the opaque asset
    // path but may switch the terminal size variant (`/0` → `/640`), so compare that stable asset
    // identity rather than a transport URL that the platform is expected to rewrite. Audio IDs,
    // local paths, different opaque keys, order, and cardinality remain strict mismatches.
    const beforeMedia = before.media.map(snapshotMediaIdentity);
    const afterMedia = after.media.map(snapshotMediaIdentity);
    if (JSON.stringify(beforeMedia) !== JSON.stringify(afterMedia)) differences.push('media');
    if (before.cover !== after.cover) differences.push('cover');
    if (before.originalUrl !== after.originalUrl) differences.push('originalUrl');
    return differences;
}

/**
 * Preserve every media identity component except WeChat's known CDN size suffix. In particular,
 * query parameters remain part of the comparison so a different format/transform cannot pass as a
 * resize merely because it shares a path prefix.
 */
function snapshotMediaIdentity(value: string): string {
    try {
        const url = new URL(value);
        if (url.hostname !== 'mmbiz.qpic.cn') return value;
        const path = url.pathname.replace(/\/(?:0|300|640|1080)$/, '');
        return `${url.origin}${path}${url.search}${url.hash}`;
    } catch {
        return value;
    }
}

function snapshotValueIsEmpty(value: string): boolean {
    const normalized = normalizeSnapshotText(value).toLowerCase();
    return normalized === '' || normalized === 'url("")' || normalized === "url('')" || normalized === 'url()';
}

/** Partial Vue/Tiptap hydration is retryable; a non-empty changed identity is not. */
function publicSnapshotIsIncomplete(expected: PublicDraftSnapshot, actual: PublicDraftSnapshot): boolean {
    if (!snapshotValueIsEmpty(expected.title) && snapshotValueIsEmpty(actual.title)) return true;
    if (!snapshotValueIsEmpty(expected.body) && snapshotValueIsEmpty(actual.body)) return true;
    if (expected.media.length > actual.media.length) return true;
    if (!snapshotValueIsEmpty(expected.cover) && snapshotValueIsEmpty(actual.cover)) return true;
    if (expected.originalUrl !== '' && actual.originalUrl === '') return true;
    return false;
}

/**
 * The live console can acknowledge 保存为草稿 before media/cover hydration reaches the canonical
 * editor (measured 2026-11-03: five partial reads before the two-media snapshot returned). Reloads
 * are read-only; publication remains impossible until the coherent snapshot matches.
 */
const PUBLIC_SAVED_EDITOR_RELOAD_LIMIT = 6;

function appmsgIdFromCanonical(value: string): string | null {
    const canonical = canonicalSavedEditorUrl(value);
    if (canonical === null) return null;
    try {
        const appmsgId = new URL(canonical).searchParams.get('appmsgid')?.trim();
        return appmsgId && appmsgId.length > 0 ? appmsgId : null;
    } catch {
        return null;
    }
}

/** Require two consecutive native readiness observations after any editor-version transition. */
async function waitForPublicEditorReadiness(page: WechatPage, deps: ModeRunDeps): Promise<boolean> {
    let consecutiveSaved = 0;
    return waitUntil(
        async () => {
            const state = await page.evaluate(nativeLayoutSaveStateScript()).catch(() => 'unknown');
            const legacyState =
                state === 'saved'
                    ? 'not-needed'
                    : await page.evaluate(nativeLegacyEditorReadyScript()).catch(() => 'unknown');
            if (state === 'saved' || legacyState === 'ready') {
                consecutiveSaved += 1;
                return consecutiveSaved >= 2;
            }
            // A fresh save transition resets the quiet window; an unreadable state is never idle
            // evidence and must not be allowed to carry a prior saved probe across the gap.
            consecutiveSaved = 0;
            return false;
        },
        Math.min(deps.stepTimeoutMs, 15_000),
        deps.pollMs,
    );
}

/**
 * Save the composed editor once, require its canonical persisted URL, reopen that URL, and compare
 * the persisted surfaces before the one and only public click. A refusal or missing native signal
 * stops before `发表`; no draft-box lookup or blind save retry is safe for the public rail.
 */
async function savePublicDraft(deps: ModeRunDeps, entry: ModeEntry): Promise<Result | PublicSaveEvidence> {
    const composed = await readPublicDraftSnapshot(entry.editor);
    if (composed === null)
        return fail(
            'public save readiness: the composed editor snapshot (title/body/media/cover) was unreadable; no publish click attempted',
        );

    const platformMetadata = deps.content.metadata?.wechatmp;
    const requestedUrl =
        platformMetadata !== null && typeof platformMetadata === 'object' && 'originalUrl' in platformMetadata
            ? platformMetadata.originalUrl
            : undefined;
    if (typeof requestedUrl === 'string' && normalizeSnapshotText(requestedUrl) !== composed.originalUrl)
        return fail('public save readiness: requested 原文链接 was not committed; no publish click attempted');

    const canonicalUrlBeforeSave = canonicalSavedEditorUrl(entry.editor.url());
    await sleep(deps.submitSettleMs);
    if ((await closeOpenDialogs(entry.editor)) !== 'closed')
        return fail('public save readiness: a residual editor dialog blocked 保存为草稿; no publish click attempted');
    const saveControl = await findSelector(entry.editor, SAVE_DRAFT, '保存为草稿 control', deps.stepTimeoutMs);
    if (!entry.editor.saveDraftAndWait)
        return fail(
            'public save readiness: the native 保存为草稿 acknowledgement probe was unavailable; no publish click attempted',
        );
    try {
        await entry.editor.saveDraftAndWait(saveControl, deps.draftTimeoutMs);
    } catch {
        return fail(
            'public save readiness: native 保存为草稿 was not acknowledged successfully; no publish click attempted',
        );
    }

    let canonicalUrl: string | null = null;
    let refusal: string | null = null;
    const saved = await waitUntil(
        async () => {
            refusal = await readStaleVersionRefusal(asPlaywrightPage(entry.editor)).catch(() => null);
            if (refusal !== null) return true;
            canonicalUrl = canonicalSavedEditorUrl(entry.editor.url());
            return canonicalUrl !== null;
        },
        deps.draftTimeoutMs,
        deps.pollMs,
    );
    if (refusal !== null) return fail(`public save refused by ${TARGET}: ${refusal}; no publish click attempted`);
    if (!saved || canonicalUrl === null) {
        return fail(
            `public save readiness: 保存为草稿 did not expose a canonical saved editor URL (action=edit with appmsgid, not isNew=1) within ${deps.draftTimeoutMs}ms; no publish click attempted`,
        );
    }
    const savedCanonicalUrl = canonicalUrl;

    // A saved editor can already be on an existing canonical URL. That URL is navigation evidence,
    // not proof that this click completed; the persisted snapshot below is the independent save proof.
    await sleep(Math.min(Math.max(deps.pollMs, 25), 500));
    await entry.editor.goto(savedCanonicalUrl, { timeout: deps.stepTimeoutMs });
    let reloaded: PublicDraftSnapshot | null = null;
    let reloadRefusal: string | null = null;
    let reloads = 0;
    let lastReloadAt = Date.now();
    const reloadIntervalMs = Math.min(Math.max(deps.pollMs * 4, 50), 2_000);
    const canonicalUrlWasPreexisting = canonicalUrlBeforeSave === savedCanonicalUrl;
    await waitUntil(
        async () => {
            reloadRefusal = await readStaleVersionRefusal(asPlaywrightPage(entry.editor)).catch(() => null);
            if (reloadRefusal !== null) return true;
            if (canonicalSavedEditorUrl(entry.editor.url()) === null) return false;
            reloaded = await readPublicDraftSnapshot(entry.editor);
            if (reloaded === null) return false;
            const differences = publicSnapshotDifferences(composed, reloaded);
            if (differences.length === 0) return true;
            if (!publicSnapshotIsIncomplete(composed, reloaded)) return true;
            if (reloads >= PUBLIC_SAVED_EDITOR_RELOAD_LIMIT) return true;
            if (Date.now() - lastReloadAt < reloadIntervalMs) return false;
            reloads += 1;
            lastReloadAt = Date.now();
            await entry.editor.goto(savedCanonicalUrl, { timeout: deps.stepTimeoutMs });
            return false;
        },
        deps.draftTimeoutMs,
        deps.pollMs,
    );
    if (reloadRefusal !== null)
        return fail(`public saved-editor refusal by ${TARGET}: ${reloadRefusal}; no publish click attempted`);
    if (reloaded === null)
        return fail(
            `public saved-editor readiness: the canonical editor reopened but its title/body/media/cover snapshot was unreadable within ${deps.draftTimeoutMs}ms; no publish click attempted`,
        );
    const differences = publicSnapshotDifferences(composed, reloaded);
    if (differences.length > 0)
        return fail(
            `public saved editor content mismatch before publication (${differences.join(', ')}); no publish click attempted`,
        );

    // The canonical snapshot can become readable before the editor's own autosave finishes. A
    // mass-send click in that interval is rejected by WeChat as a stale draft even though every
    // persisted field already matches; require two consecutive native readiness probes before handing
    // control to publishContent. The v2 rail accepts 已保存; the measured legacy editor has its own
    // explicit manual-save markers. A saving → saved transition and an already-idle editor are accepted;
    // this is a readiness guard, not a publish retry.
    const autoSaveSettled = await waitForPublicEditorReadiness(entry.editor, deps);
    if (!autoSaveSettled)
        return fail(
            `public saved-editor readiness: native 保存状态 did not provide two consecutive recognized readiness probes within ${Math.min(deps.stepTimeoutMs, 15_000)}ms; no publish click attempted`,
        );
    return {
        saveControl,
        canonicalUrl: savedCanonicalUrl,
        canonicalUrlForMetadata: savedEditorUrlForMetadata(savedCanonicalUrl),
        saveSignal: canonicalUrlWasPreexisting ? 'persisted-snapshot' : 'canonical-url-transition+snapshot',
        snapshot: composed,
    };
}

interface StaleVersionRecovery {
    editor: WechatPage;
    canonicalUrl: string;
    canonicalUrlForMetadata: string;
}

/**
 * Follow only the platform's known pre-confirmation stale-version escape hatch. This performs no
 * save and never retries an unknown outcome: 查看新草稿 is the one measured action that switches the
 * editor to the platform's latest persisted version before a second initial 发表 click.
 */
async function recoverStaleVersion(
    deps: ModeRunDeps,
    entry: ModeEntry,
    saved: PublicSaveEvidence,
): Promise<Result | StaleVersionRecovery> {
    const expectedAppmsgId = appmsgIdFromCanonical(saved.canonicalUrl);
    if (expectedAppmsgId === null)
        return fail('public stale-version recovery: the saved editor identity was not canonical; no retry attempted');

    const latest = await findUniqueVisibleSelector(
        entry.editor,
        PUBLISH_VIEW_LATEST,
        Math.min(CONFIRM_TIMEOUT_MS, deps.stepTimeoutMs),
        deps.pollMs,
    );
    if (latest.selector === undefined)
        return fail(`public stale-version recovery: 查看新草稿 was ${latest.reason}; no second 发表 click attempted`);

    const before = deps.pages().length;
    try {
        await clickSelector(entry.editor, latest.selector, deps.stepTimeoutMs);
    } catch {
        return fail('public stale-version recovery: 查看新草稿 could not be clicked; no second 发表 click attempted');
    }
    const latestEditor =
        (await followNewPage(deps.pages, before, Math.min(deps.stepTimeoutMs, CONFIRM_TIMEOUT_MS))) ?? entry.editor;

    let latestCanonicalUrl: string | null = null;
    const canonicalReady = await waitUntil(
        async () => {
            latestCanonicalUrl = canonicalSavedEditorUrl(latestEditor.url());
            if (latestCanonicalUrl === null) return false;
            // A click that leaves the original stale dialog visible is not a version transition. Do
            // not accept the unchanged editor's matching snapshot as latest-version evidence.
            const refusal = await readStaleVersionRefusal(asPlaywrightPage(latestEditor)).catch(() => '__unreadable__');
            return refusal === null;
        },
        deps.draftTimeoutMs,
        deps.pollMs,
    );
    if (!canonicalReady || latestCanonicalUrl === null)
        return fail(
            'public stale-version recovery: 查看新草稿 did not expose a canonical saved editor route; no second 发表 click attempted',
        );

    const actualAppmsgId = appmsgIdFromCanonical(latestCanonicalUrl);
    if (actualAppmsgId !== expectedAppmsgId)
        return fail(
            `public stale-version recovery: 查看新草稿 opened appmsgid=${actualAppmsgId ?? 'unknown'}, expected appmsgid=${expectedAppmsgId}; no second 发表 click attempted`,
        );

    let latestSnapshot: PublicDraftSnapshot | null = null;
    let differences: string[] = [];
    const snapshotSettled = await waitUntil(
        async () => {
            latestSnapshot = await readPublicDraftSnapshot(latestEditor);
            if (latestSnapshot === null) return false;
            differences = publicSnapshotDifferences(saved.snapshot, latestSnapshot);
            // Partial hydration may still fill empty media/body/cover fields. A non-empty changed
            // identity is final evidence of a different latest version and must stop immediately.
            return differences.length === 0 || !publicSnapshotIsIncomplete(saved.snapshot, latestSnapshot);
        },
        deps.draftTimeoutMs,
        deps.pollMs,
    );
    if (!snapshotSettled || latestSnapshot === null)
        return fail(
            'public stale-version recovery: latest editor snapshot was unreadable; no second 发表 click attempted',
        );
    if (differences.length > 0)
        return fail(
            `public stale-version recovery: latest editor content mismatch (${differences.join(', ')}); no second 发表 click attempted`,
        );

    if (!(await waitForPublicEditorReadiness(latestEditor, deps)))
        return fail(
            'public stale-version recovery: latest editor did not provide two consecutive recognized readiness probes; no second 发表 click attempted',
        );

    return {
        editor: latestEditor,
        canonicalUrl: latestCanonicalUrl,
        canonicalUrlForMetadata: savedEditorUrlForMetadata(latestCanonicalUrl),
    };
}

/**
 * The platform's own answer after 发表: its success marker, or one of the recorded refusal/hint lines
 * (§5, §5.3) which are relayed as the actionable message the operator needs.
 */
async function publishOutcome(page: WechatPage): Promise<string | null> {
    const success = await readScopedSignal(asPlaywrightPage(page), PUBLISH_SUCCESS);
    if (success !== null) return `sent:${success}`;
    const refusal = await readScopedSignal(asPlaywrightPage(page), PLATFORM_REFUSAL);
    if (refusal !== null) return `refused:${refusal}`;
    return null;
}

interface VisibleSelectorProbe {
    selector?: string;
    reason: 'missing' | 'ambiguous';
}

interface PublicConfirmation {
    finalSelector: string;
    notifySubscribers: boolean | null;
    notifySubscribersPolicy: 'preserve' | 'disabled';
}

interface PreconfirmationStaleVersion {
    kind: 'stale-version';
    refusal: string;
}

/**
 * Resolve one visible control without allowing a hidden/duplicate match to become a click target.
 * The live console can leave old dialog nodes mounted, so a first-match helper is unsafe here.
 */
async function findUniqueVisibleSelector(
    page: WechatPage,
    selectors: readonly string[],
    timeoutMs: number,
    pollMs: number,
): Promise<VisibleSelectorProbe> {
    let reason: VisibleSelectorProbe['reason'] = 'missing';
    let selector: string | undefined;
    const found = await waitUntil(
        async () => {
            for (const candidate of selectors) {
                const locator = page.locator(candidate);
                const count = await locator.count().catch(() => 0);
                if (count > 1) {
                    reason = 'ambiguous';
                    return true;
                }
                if (count !== 1) continue;
                const visible = await locator
                    .first()
                    .isVisible()
                    .catch(() => false);
                if (!visible) continue;
                selector = candidate;
                return true;
            }
            return false;
        },
        timeoutMs,
        pollMs,
    );
    return found && selector !== undefined ? { selector, reason } : { reason };
}

async function readPublishNotifySubscribers(page: WechatPage): Promise<boolean | null> {
    try {
        const value = await page.evaluate(PUBLISH_NOTIFY_STATE_SCRIPT);
        return typeof value === 'boolean' ? value : null;
    } catch {
        return null;
    }
}

function shouldNotifySubscribers(content: Content): boolean {
    const wechatmp = content.metadata?.wechatmp;
    if (wechatmp === null || typeof wechatmp !== 'object' || Array.isArray(wechatmp)) return true;
    return (wechatmp as Record<string, unknown>).notifySubscribers !== false;
}

/**
 * Complete the measured mass-send dialog exactly once. The opt-out is deliberately stricter than
 * the default policy: if 群发通知 cannot be uniquely observed as ON and then OFF, stop before the
 * final 发表 click so a daily run cannot silently consume the next notification quota. The returned
 * state is the platform's actual pre-click switch value; the policy is recorded separately because
 * the default preserves an already-OFF platform setting rather than enabling notifications.
 */
async function confirmPublicPublish(
    page: WechatPage,
    notifySubscribers: boolean,
    stepTimeoutMs: number,
    pollMs: number,
): Promise<Result | PublicConfirmation | PreconfirmationStaleVersion> {
    const confirmationTimeoutMs = Math.min(CONFIRM_TIMEOUT_MS, stepTimeoutMs);
    const dialog = await findUniqueVisibleSelector(page, PUBLISH_DIALOG, confirmationTimeoutMs, pollMs);
    if (dialog.selector === undefined) {
        if (dialog.reason === 'missing') {
            const refusal = await readStaleVersionRefusal(asPlaywrightPage(page)).catch(() => null);
            if (refusal !== null) return { kind: 'stale-version', refusal };
        }
        return fail(`public confirmation: the 发表 dialog was ${dialog.reason}; no final publish click attempted`);
    }

    let observedNotifySubscribers: boolean | null = null;
    if (!notifySubscribers) {
        const toggle = await findUniqueVisibleSelector(page, PUBLISH_NOTIFY_TOGGLE, confirmationTimeoutMs, pollMs);
        if (toggle.selector === undefined)
            return fail(
                `public confirmation: 群发通知 switch was ${toggle.reason === 'missing' ? 'unavailable' : 'ambiguous'}; no final publish click attempted`,
            );
        const before = await readPublishNotifySubscribers(page);
        if (before === null)
            return fail('public confirmation: 群发通知 switch state was unreadable; no final publish click attempted');
        if (before) await clickSelector(page, toggle.selector, stepTimeoutMs);
        const off = await waitUntil(
            async () => (await readPublishNotifySubscribers(page)) === false,
            confirmationTimeoutMs,
            pollMs,
        );
        if (!off)
            return fail('public confirmation: 群发通知 switch did not verify OFF; no final publish click attempted');
    }

    const final = await findUniqueVisibleSelector(page, PUBLISH_FINAL, confirmationTimeoutMs, pollMs);
    if (final.selector === undefined)
        return fail(`public confirmation: final 发表 button was ${final.reason}; no final publish click attempted`);
    observedNotifySubscribers = await readPublishNotifySubscribers(page);
    if (!notifySubscribers && observedNotifySubscribers !== false)
        return fail(
            'public confirmation: 群发通知 switch did not remain verifiably OFF; no final publish click attempted',
        );
    await clickSelector(page, final.selector, stepTimeoutMs);
    return {
        finalSelector: final.selector,
        notifySubscribers: observedNotifySubscribers,
        notifySubscribersPolicy: notifySubscribers ? 'preserve' : 'disabled',
    };
}

/**
 * Publish. Reached only for an explicit `publishStatus: 'public'` — the transport refuses every
 * other value before a browser opens. The final confirmation is irreversible and is clicked once;
 * the only pre-confirmation recovery is the bounded, native 查看新草稿 transition handled below.
 * An unobserved final send is never repeated because a second click could duplicate the message.
 */
async function publishContent(
    input: ModeInput,
    deps: ModeRunDeps,
    entry: ModeEntry,
    composed: ComposeReport,
): Promise<Result> {
    // The persisted editor snapshot is an article-only readiness contract. The other console
    // operations historically publish directly after composition; routing them through the article
    // save probe would reject valid media posts when that probe is unavailable or intentionally fails.
    const saved = input.operation === '文章' ? await savePublicDraft(deps, entry) : undefined;
    if (saved !== undefined && 'ok' in saved) return saved;
    const notifySubscribers = shouldNotifySubscribers(deps.content);
    let staleVersionRecoveryCount = 0;
    let finalSavedEditorUrl = saved?.canonicalUrlForMetadata;
    await sleep(deps.submitSettleMs);
    const control = await findSelector(entry.editor, PUBLISH_SEND, '发表 control', deps.stepTimeoutMs);
    const urlBefore = entry.editor.url();
    await clickSelector(entry.editor, control, deps.stepTimeoutMs);
    let confirmation = await confirmPublicPublish(entry.editor, notifySubscribers, deps.stepTimeoutMs, deps.pollMs);
    if ('ok' in confirmation) return confirmation;
    if ('kind' in confirmation) {
        if (saved === undefined)
            return fail(
                `public confirmation: ${confirmation.refusal}; no canonical saved-editor evidence was available for recovery; no second 发表 click attempted`,
            );
        const recovered = await recoverStaleVersion(deps, entry, saved);
        if ('ok' in recovered) return recovered;
        entry.editor = recovered.editor;
        finalSavedEditorUrl = recovered.canonicalUrlForMetadata;
        staleVersionRecoveryCount = 1;
        const retryControl = await findSelector(
            entry.editor,
            PUBLISH_SEND,
            '发表 control after 查看新草稿',
            deps.stepTimeoutMs,
        );
        await clickSelector(entry.editor, retryControl, deps.stepTimeoutMs);
        confirmation = await confirmPublicPublish(entry.editor, notifySubscribers, deps.stepTimeoutMs, deps.pollMs);
        if ('ok' in confirmation) return confirmation;
        if ('kind' in confirmation)
            return fail(
                `public confirmation: ${confirmation.refusal} after bounded 查看新草稿 recovery; no final publish click attempted`,
            );
    }

    const outcome = await expectOutcome(() => publishOutcome(entry.editor), {
        timeoutMs: deps.stepTimeoutMs,
        label: `publish confirmation '${control}'`,
        pollMs: deps.pollMs,
    });
    if (!outcome.ok) {
        return fail(
            `publish submission: state unknown — '${control}' was clicked from ${urlBefore} but neither the platform's success marker nor one of its recorded refusals was observed within ${deps.stepTimeoutMs}ms (now ${entry.editor.url()}). Check the ${TARGET} console before retrying: a retry could publish twice.`,
        );
    }
    if (outcome.evidence.startsWith('refused:')) {
        return fail(`publish refused by ${TARGET}: ${outcome.evidence.slice('refused:'.length)}`);
    }
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        message: `${TARGET} ${input.operation} published`,
        metadata: {
            ...baseMetadata(input, deps, entry),
            ...(saved === undefined
                ? {}
                : {
                      draftSaveControl: saved.saveControl,
                      savedEditorUrl: finalSavedEditorUrl ?? saved.canonicalUrlForMetadata,
                      draftSaveSignal: saved.saveSignal,
                      staleVersionRecoveryCount,
                  }),
            publishControl: control,
            finalPublishControl: confirmation.finalSelector,
            notifySubscribers: confirmation.notifySubscribers,
            notifySubscribersPolicy: confirmation.notifySubscribersPolicy,
            publishSignal: outcome.evidence,
            titlePath: composed.titlePath,
            ...(composed.warnings.length > 0 ? { warnings: composed.warnings } : {}),
            ...(composed.enrichWarnings.length > 0 ? { enrichWarnings: composed.enrichWarnings } : {}),
        },
    });
}

/**
 * Text inventory of whatever modal is still open on `page` — the diagnostic a blocked submit click
 * needs (2026-10-12: `保存为草稿` was covered by a dialog footer for 30 s and the failure named only
 * the Playwright timeout). Covers the inner dialog and the overlay wrapper, both of which can be the
 * element that intercepts pointer events.
 */
async function openDialogInventory(page: WechatPage): Promise<string> {
    const raw = await page
        .evaluate(
            `[...document.querySelectorAll('.weui-desktop-dialog, .weui-desktop-dialog__wrp')]` +
                `.filter((d) => d.offsetWidth).map((d) => (d.className || '') + ' :: ' + ` +
                `(d.innerText || '').replace(/\\s+/g, ' ').slice(0, 160)).join(' || ')`,
        )
        .catch(() => '');
    return typeof raw === 'string' ? raw.slice(0, 600) : '';
}

/**
 * The task 0290 CGI draft route: eligible plain 文章 drafts dispatch through the console page's own
 * operate_appmsg subpath (./cgi-draft on the 0289 media pipeline) without ever entering the DOM
 * editor. Ineligible content or an invalid required cover returns undefined BEFORE any dispatch, so
 * the DOM flow keeps every advanced feature; once the route is taken it NEVER retries and NEVER
 * falls back to DOM — an unverifiable create is an ambiguous submission, reported as ok:false only.
 */
async function runCgiDraft(input: ModeInput, deps: ModeRunDeps): Promise<Result | undefined> {
    if (input.operation !== '文章') return undefined; // narrow the ModeInput union (runMode already gates this)
    try {
        assertEligibleCgiDraft(deps.content);
    } catch (error) {
        // Advanced metadata (e.g. metadata.wechatmp.*) is the DOM flow's input by design — a silent
        // hand-back, no warning. Any other eligibility throw would be a library bug: fail loud.
        if (error instanceof WechatCgiDraftError && error.code === 'ineligible') return undefined;
        throw error;
    }
    const metadata = deps.content.metadata ?? {};
    const bodyImages = input.images; // already resolved + validated by modes.resolveBodyImages pre-runMode
    if (bodyImages.length === 0) return undefined;
    // Cover parity: top-level coverPath wins, else the first body image (默认首图为封面).
    const cover =
        typeof metadata.coverPath === 'string' && metadata.coverPath.length > 0
            ? metadata.coverPath
            : (bodyImages[0] ?? '');
    try {
        await readLocalImageBytes(cover); // still local-only: validates readable, nonempty, ≤10 MiB, known mime
    } catch {
        return undefined;
    }
    // Plain-article body images ride the 0289 media pipeline (P2 fix: they are never silently
    // dropped — the DOM path attaches these same files). localImages maps img src → local path;
    // prepareArticleMedia reads + uploads each (src values are raw paths so they match keys).
    const localImages: Record<string, string> = {};
    for (const path of bodyImages) localImages[path] = path;
    const imageBlock = bodyImages.map((path) => `<img src="${path}">`).join('');
    try {
        const session = await extractWechatCgiSession(deps.entry);
        let media: WechatArticleMedia;
        try {
            media = await prepareArticleMedia(deps.entry, session, {
                html: imageBlock + markdownToWechatHtml(bodyOf(deps.content)),
                coverPath: cover,
                localImages,
            });
        } catch (error) {
            // 0289 media vocabulary failing inside this branch is dispatch-side (never retried, never
            // DOM-fallback); report it in the branch's own shape with the pre-create stage.
            if (error instanceof WechatCgiDraftError) throw error;
            return ResultSchema.parse({
                ok: false,
                target: TARGET,
                error: error instanceof Error ? error.message : String(error),
                metadata: { operation: input.operation, publishStatus: deps.publishStatus, stage: 'media-preparation' },
            });
        }
        const draft = await createWechatArticleDraft(deps.entry, session, deps.content, media);
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            // The verified draft id read back from the appmsg list receipt (Design R3).
            id: draft.appMsgId,
            // The canonical edit route: no token in it, so the URL is secret-free by construction.
            url: `https://mp.weixin.qq.com${draft.editPath}`,
            metadata: {
                operation: input.operation,
                publishStatus: deps.publishStatus,
                stage: 'draft-created',
                appMsgId: draft.appMsgId,
                coverFileIds: [media.cover.wide.fileId, media.cover.square.fileId],
                cdnMigratedImages: media.images.length,
            },
        });
    } catch (error) {
        // Only WechatCgiDraftError can reach this outer catch (media vocabulary is wrapped by the
        // inner media-preparation catch above); anything else is a library bug — propagate loudly.
        if (!(error instanceof WechatCgiDraftError)) throw error;
        return ResultSchema.parse({
            ok: false,
            target: TARGET,
            error: error.message,
            metadata: {
                operation: input.operation,
                publishStatus: deps.publishStatus,
                stage: error.stage,
                ...(error.metadata.ambiguousSubmission === true ? { ambiguousSubmission: true } : {}),
            },
        });
    }
}

/**
 * Run one validated operation end to end: enter its mode, compose the post, then take it to a draft
 * or — only on an explicit live request — publish it.
 */
export async function runMode(input: ModeInput, deps: ModeRunDeps): Promise<Result> {
    // The CGI draft branch runs BEFORE mode entry and consumes neither enterMode nor compose.
    if (input.operation === '文章' && deps.publishStatus === 'draft') {
        const cgi = await runCgiDraft(input, deps);
        if (cgi !== undefined) return cgi;
    }
    const entry = await enterMode(deps, input.operation);
    const composed = await compose(input, deps, entry);
    // 2026-10-12: a throw from the submit step drops every diagnostic the compose phase collected —
    // a leaked settings dialog blocked 保存为草稿 on the daily run and the failure Result carried only
    // the Playwright timeout, so the stuck step had to be rediscovered by hand. Ride them on the error.
    const diagnostics = [...composed.warnings, ...composed.enrichWarnings];
    try {
        const result =
            deps.publishStatus === 'public'
                ? await publishContent(input, deps, entry, composed)
                : await saveDraft(input, deps, entry, composed);
        if (!result.ok && diagnostics.length > 0) {
            return { ...result, error: `${result.error} — compose diagnostics: ${diagnostics.join(' | ')}` };
        }
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const blocked = await openDialogInventory(entry.editor);
        const carried = [
            ...(diagnostics.length > 0 ? [`compose diagnostics: ${diagnostics.join(' | ')}`] : []),
            ...(blocked !== '' ? [`open dialogs at submit: ${blocked}`] : []),
        ];
        if (carried.length === 0) throw error;
        throw new Error(`${message} — ${carried.join(' — ')}`);
    }
}

/**
 * Harvested subset of wt md-to-wechat: headings, paragraphs, fenced code, lists, inline.
 * TypeScript only — no Python, no theme CLI.
 *
 * Kept instead of the shared `markdownToHtml` because the two differ on safety, measured on Bun
 * 1.3.14: `Bun.markdown.html` passes raw HTML straight through (`<script>` included) and renders
 * `javascript:` link destinations, while this renderer escapes text and refuses non-http(s) link
 * schemes (R9). The *insertion* is the shared `pasteHtml` either way, so the ADR-029 rail holds.
 */
export function markdownToWechatHtml(markdown: string): string {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let inCode = false;
    let code: string[] = [];
    let listType: 'ul' | 'ol' | null = null;

    const closeList = (): void => {
        if (listType) {
            out.push(`</${listType}>`);
            listType = null;
        }
    };

    const inline = (text: string): string =>
        escapeHtml(text)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // `href` is already HTML-escaped (inline() escapes before replacing), so a `"` can no
            // longer close the attribute. The scheme allowlist is still required: escaping does not
            // neutralise `javascript:`. Non-http(s) links degrade to their label text.
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) =>
                /^https?:\/\//i.test(href) ? `<a href="${href}">${text}</a>` : text,
            );

    for (const line of lines) {
        if (line.startsWith('```')) {
            if (inCode) {
                out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
                code = [];
                inCode = false;
            } else {
                closeList();
                inCode = true;
            }
            continue;
        }
        if (inCode) {
            code.push(line);
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading?.[1] && heading[2]) {
            closeList();
            const level = Math.min(heading[1].length, 3);
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            continue;
        }
        const ul = line.match(/^[-*]\s+(.+)$/);
        if (ul?.[1]) {
            if (listType !== 'ul') {
                closeList();
                listType = 'ul';
                out.push('<ul>');
            }
            out.push(`<li>${inline(ul[1])}</li>`);
            continue;
        }
        const ol = line.match(/^\d+\.\s+(.+)$/);
        if (ol?.[1]) {
            if (listType !== 'ol') {
                closeList();
                listType = 'ol';
                out.push('<ol>');
            }
            out.push(`<li>${inline(ol[1])}</li>`);
            continue;
        }
        closeList();
        if (line.trim().length === 0) continue;
        out.push(`<p>${inline(line.trim())}</p>`);
    }
    closeList();
    if (inCode) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    return out.join('');
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Audio at the article top (operator request 2026-09-29; upload path added 2026-10-10).
 *
 * Reuses a same-title 素材库 material when one exists (UNIQUE exposed-title match, identity
 * captured); otherwise UPLOADS it. The operator's measured upload shape: 音频 menu → 上传音频 → pick
 * the audio file → 上传封面 → pick the cover → type the title → tick 我已阅读并同意《公众平台音频上传服务规则》
 * → 保存 → the material list reopens → select the row whose exposed title matches uniquely → 插入.
 * 插入 places it at the caret, so the caret is put at the body start first.
 *
 * Fail-soft — every non-committed outcome returns a warning string; `''` means the inserted node is
 * the body's first content AND carries the selected material's identity (task 0260 R2).
 */
export async function insertAudioMaterial(
    page: WechatPage,
    input: { title: string; audioPath: string; coverPath: string },
): Promise<string> {
    const { title, audioPath, coverPath } = input;
    const CARET = `(async () => {
            const pm = [...document.querySelectorAll('.ProseMirror')].find((e) => !(e.getAttribute('data-placeholder') ?? '').includes('标题'));
            if (!pm || !pm.firstChild) return;
            pm.focus();
            const r = document.createRange();
            // The first child can be a non-editable image atom. Select the boundary before it,
            // not a position inside that atom which ProseMirror discards on toolbar focus.
            r.setStart(pm, 0);
            r.collapse(true);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(r);
            document.dispatchEvent(new Event('selectionchange'));
            await new Promise(resolve => setTimeout(resolve, 100));
        })()`;
    /** Trim + collapse whitespace/NBSP — MP titles carry `&nbsp;` entities (0272 capture). */
    const norm = (value: unknown): string =>
        typeof value === 'string' ? value.replace(/[\s\u00a0]+/g, ' ').trim() : '';
    /** Unique exposed-title match; ticks only an unticked row and captures its stable identity
     *  (data-mediaid/data-id, else the thumb's media URL) for the body readback. Never first-item. */
    const MATCH = `(() => {
            const norm = (v) => (v ?? '').replace(/[\\s\\u00a0]+/g, ' ').trim();
            const want = ${JSON.stringify(norm(title))};
            const rows = [...document.querySelectorAll('label.frm_checkbox_label.audio_item')]
                .filter((l) => l.offsetWidth > 0);
            const hits = rows.filter((l) => norm((l.querySelector('.audio_title') ?? l).textContent) === want);
            if (hits.length === 0) return 'missing';
            if (hits.length > 1) return 'ambiguous';
            const hit = hits[0];
            const cb = (hit.closest('li') ?? hit.parentElement)?.querySelector('input[type=checkbox]');
            if (!cb) return 'nobox';
            if (!cb.checked) cb.click();
            const wrp = hit.closest('.audio_item_wrp') ?? hit.parentElement;
            const thumb = wrp?.querySelector('.audio_item_thumb');
            const identity = wrp?.getAttribute('data-mediaid') ?? wrp?.getAttribute('data-id') ??
                (thumb ? (thumb.style.backgroundImage.match(/url\\("?([^")]+)"?\\)/)?.[1] ?? '') : '');
            return JSON.stringify({ state: 'checked', identity });
        })()`;
    /** Tick the service-rules acknowledgement, found by its own label text rather than a class. */
    const AGREE = `(() => {
            const node = [...document.querySelectorAll('.weui-desktop-dialog label, .audio_dialog label')]
                .find((e) => (e.textContent ?? '').includes('我已阅读并同意') && e.querySelector('input[type=checkbox]'));
            if (!node) return 'no-label';
            const scope = node.closest('label') ?? node.parentElement;
            const cb = scope?.querySelector('input[type=checkbox]') ?? document.querySelector('input[type=checkbox].js_agree');
            if (!cb) return 'no-box';
            if (!cb.checked) cb.click();
            return cb.checked ? 'checked' : 'unchecked';
        })()`;
    const INSERT = `(() => {
            const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '插入' && b.offsetWidth > 0);
            if (!btn) return false;
            btn.click();
            return true;
        })()`;
    const CANCEL = `(() => {
            const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '取消' && b.offsetWidth > 0);
            btn?.click();
        })()`;
    const VERIFY = `(() => {
            const pm = [...document.querySelectorAll('.ProseMirror')].find((e) => !(e.getAttribute('data-placeholder') ?? '').includes('标题'));
            if (!pm) return JSON.stringify({ state: 'noeditor' });
            const first = pm.firstElementChild;
            if (!first) return JSON.stringify({ state: 'absent' });
            const selector = 'mp-common-mpaudio, mpvoice, [data-mediaid]';
            const node = first.matches(selector) ? first : first.querySelector(selector);
            if (!node) return JSON.stringify({ state: pm.querySelector(selector) ? 'not-top' : 'absent' });
            const identity = node.getAttribute('data-mediaid') ?? node.getAttribute('cover') ?? node.getAttribute('voice_encode_fileid') ?? node.getAttribute('data-appid') ??
                node.getAttribute('data-src') ?? node.getAttribute('src') ?? '';
            return JSON.stringify({ state: 'top', identity });
        })()`;

    /** Upload the audio + its cover, acknowledge the rules, and 保存. Returns a warning or null. */
    const upload = async (): Promise<string | null> => {
        const uploadControl = await trySelectors(page, UPLOAD_AUDIO);
        if (!uploadControl.found) return '音频: 上传音频 control not found in the audio dialog';
        // Click the winner, never a joined union: `text=…, css…` mixes selector engines and
        // Playwright parses the whole string as CSS — zero matches (DOM fixture 0260).
        await clickSelector(page, uploadControl.selector ?? UPLOAD_AUDIO[0] ?? 'text=上传音频', 8_000);
        const audioInput = await trySelectors(page, AUDIO_UPLOAD_INPUT, { visible: false });
        if (!audioInput.found) return '音频: no audio file input appeared';
        await uploadFile(asPlaywrightPage(page), audioInput.selector ?? AUDIO_UPLOAD_INPUT.join(', '), audioPath, {
            timeoutMs: 60_000,
        });
        // The form requires a cover before it will save.
        const coverControl = await trySelectors(page, UPLOAD_COVER);
        if (coverControl.found) {
            await clickSelector(page, coverControl.selector ?? UPLOAD_COVER[0] ?? 'text=上传封面', 8_000);
            const coverInput = await trySelectors(page, AUDIO_COVER_INPUT, { visible: false });
            if (coverInput.found) {
                const chooser = '.weui-desktop-dialog:visible:has(h3:has-text("选择图片"))';
                const hasChooser = (await page.locator(chooser).count()) > 0;
                const coverName = hasChooser ? await coverLibraryName(coverPath) : baseName(coverPath);
                let existing = 0;
                if (hasChooser) {
                    const libraryReady = await waitUntil(
                        async () =>
                            Boolean(
                                await page.evaluate(
                                    `!document.querySelector('#js_image_dialog_list_wrp .weui-desktop-loading')`,
                                ),
                            ),
                        5_000,
                    );
                    if (!libraryReady) return '音频: 封面素材库加载未完成，未上传重复封面';
                    existing = Number(
                        await page.evaluate(
                            `([...document.querySelectorAll('.weui-desktop-img-picker__item')].filter(row => row.offsetWidth > 0 && row.querySelector('.weui-desktop-img-picker__img-title')?.textContent?.trim() === ${JSON.stringify(coverName)})).length`,
                        ),
                    );
                    if (existing > 1) return '音频: 内容绑定封面存在多个同名素材，未猜测选择';
                }
                let uploadPath = coverPath;
                let temporaryDir: string | undefined;
                if (hasChooser && existing === 0) {
                    temporaryDir = join(tmpdir(), `kk-wechat-cover-${randomUUID()}`);
                    if (!mkdirExclusive(temporaryDir)) throw new Error('Private cover upload directory already exists');
                    uploadPath = join(temporaryDir, coverName);
                }
                try {
                    if (temporaryDir !== undefined) await createNodeFileSystem().copy(coverPath, uploadPath);
                    if (existing === 0) {
                        await uploadFile(
                            asPlaywrightPage(page),
                            coverInput.selector ?? AUDIO_COVER_INPUT.join(', '),
                            uploadPath,
                            {
                                timeoutMs: 60_000,
                            },
                        );
                    }
                    if (hasChooser) {
                        const selectedName = JSON.stringify(coverName);
                        const selected = await waitUntil(
                            async () =>
                                Boolean(
                                    await page.evaluate(`(() => {
                            const rows = [...document.querySelectorAll('.weui-desktop-img-picker__item')]
                                .filter(row => row.offsetWidth > 0 && row.querySelector('.weui-desktop-img-picker__img-title')?.textContent?.trim() === ${selectedName});
                            if (rows.length !== 1) return false;
                            const row = rows[0];
                            if (!row.classList.contains('selected')) row.click();
                            return row.classList.contains('selected');
                        })()`),
                                ),
                            30_000,
                        );
                        if (!selected) return '音频: 上传封面未出现唯一已选中的同名图片，未提交封面';
                        const next = await findSelector(
                            page,
                            [`${chooser} button:has-text("下一步"):not(.weui-desktop-btn_disabled)`],
                            '音频封面 下一步',
                            30_000,
                        );
                        await clickSelector(page, next, 8_000);
                        const finish = await findSelector(
                            page,
                            [`${chooser} button:has-text("完成"):not(.weui-desktop-btn_disabled)`],
                            '音频封面 完成',
                            30_000,
                        );
                        await clickSelector(page, finish, 8_000);
                        const closed = await waitUntil(
                            async () => !(await page.locator(chooser).first().isVisible()),
                            8_000,
                        );
                        if (!closed) return '音频: 封面选择器完成后未关闭，未保存音频';
                    }
                } finally {
                    if (temporaryDir !== undefined) {
                        await createNodeFileSystem().deleteFile(uploadPath);
                        rmdir(temporaryDir);
                    }
                }
            }
        }
        const titleInput = await trySelectors(page, AUDIO_TITLE_INPUT);
        if (titleInput.found) await fillSelector(page, titleInput.selector ?? AUDIO_TITLE_INPUT.join(', '), title);
        const agreed = String(await page.evaluate(AGREE));
        if (agreed !== 'checked') return `音频: 服务规则勾选失败 (${agreed})`;
        const save = await findSelector(
            page,
            UPLOAD_SAVE.map((selector) => `${selector}:not(.weui-desktop-btn_disabled):not([disabled])`),
            '音频上传完成且封面已提交后的保存按钮',
            90_000,
        );
        await clickSelector(page, save, 8_000);
        return null;
    };

    /** One MATCH read; a throwing probe stays 'error' (unknown, never treated as missing). */
    const matchOnce = async (): Promise<string> => {
        try {
            return String(await page.evaluate(MATCH));
        } catch {
            return 'error';
        }
    };
    /** Poll the picker while rows stream in; 'missing' keeps polling, JSON answers settle it. */
    const awaitMatch = async (): Promise<string> => {
        let match = await matchOnce();
        for (let i = 0; match === 'missing' && i < AUDIO_ROW_RETRIES; i += 1) {
            await page.waitForTimeout?.(AUDIO_ROW_SETTLE_MS);
            match = await matchOnce();
        }
        return match;
    };
    try {
        await page.evaluate(CARET);
        // Native navigation updates ProseMirror's selection bookmark, which toolbar dialogs restore.
        await page.press?.(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
        // Open the toolbar dropdown first (measured 2026-10-13): the menu item is hidden until its
        // trigger is clicked, so the old direct `js_insertaudio` click timed out.
        await page.evaluate(`document.querySelector(${JSON.stringify(AUDIO_TOOLBAR_TRIGGER)})?.click()`);
        await page.waitForTimeout?.(300);
        await page.evaluate(`document.querySelector(${JSON.stringify(AUDIO_MENU)})?.click()`);
        await waitForVisible(page, AUDIO_DIALOG, AUDIO_DIALOG_TIMEOUT_MS);
        let match = await awaitMatch();
        if (match === 'missing') {
            // No reusable material: upload one, then POLL until the new row actually exists — never
            // assume the upload auto-selected a default row (task 0260 AC2).
            const uploadWarning = await upload();
            if (uploadWarning !== null) {
                await page.evaluate(CANCEL);
                return uploadWarning;
            }
            await waitForVisible(page, AUDIO_DIALOG, AUDIO_DIALOG_TIMEOUT_MS);
            match = await awaitMatch();
            if (match === 'missing') {
                await page.evaluate(CANCEL);
                return `音频: 保存后素材列表未出现「${title}」，未插入音频`;
            }
            if (match === 'error') {
                await page.evaluate(CANCEL);
                return '音频: 保存后素材匹配探测失败，未插入音频';
            }
        } else if (match === 'error') {
            await page.evaluate(CANCEL);
            return '音频: 素材匹配探测失败，未插入音频';
        }
        // Parse the match; anything but a unique ticked row stays a warning (never first-item).
        let identity = '';
        try {
            const parsed = JSON.parse(match) as { state?: string; identity?: string };
            if (parsed.state !== 'checked') {
                await page.evaluate(CANCEL);
                return `音频: 素材「${title}」${parsed.state === 'ambiguous' ? '列表匹配到多个同名条目，身份不唯一' : parsed.state === 'nobox' ? '行没有勾选框' : '未选中'}，未插入音频`;
            }
            identity = parsed.identity ?? '';
        } catch {
            await page.evaluate(CANCEL);
            return '音频: 素材匹配探测返回未知结果，未插入音频';
        }
        if ((await page.evaluate(INSERT)) !== true) {
            await page.evaluate(CANCEL);
            return '音频: 插入按钮未找到，请手动插入';
        }
        await page.waitForTimeout?.(2_000);
        let verdict: { state?: string; identity?: string };
        try {
            verdict = JSON.parse(String(await page.evaluate(VERIFY))) as { state?: string; identity?: string };
        } catch {
            return '音频: 已插入但无法读取正文状态，请手动检查';
        }
        if (verdict.state === 'absent' || verdict.state === 'noeditor') return '音频: 插入未生效，请手动检查';
        if (verdict.state !== 'top') return '音频: 已插入但未在文首，请手动调整位置';
        // Identity readback (0260 R2): success requires the selected identity to reappear on the
        // inserted node; an unreadable identity is an unverifiable warning, never a silent pass.
        if (identity === '' || (verdict.identity ?? '') === '' || verdict.identity !== identity)
            return `音频: 已插入文首但无法核对素材身份（selected=${identity || '未读到'} node=${(verdict.identity ?? '').slice(0, 60) || '未读到'}），请手动核对`;
        return '';
    } catch (error) {
        return `音频: ${error instanceof Error ? error.message.slice(0, 120) : '自动插入失败'}，请手动插入`;
    }
}
