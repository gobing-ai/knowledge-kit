/**
 * shipinhao-pub selectors — every selector/URL/regex/timeout constant this channel resolves
 * (task 0296).
 *
 * Grounding: the recovered WeChat Channels (视频号) extension adapter
 * `.spur/run/yijianfa-source/platforms/shipinhao.js` (2817 lines, verified read-only 2026-10-15)
 * pins the publishing-page mechanics cited below. The page may run inside a `<wujie-app>`
 * shadowRoot; once wujie-app exists the vendor waits for its shadowRoot and never falls back to
 * document (shipinhao.js:3-5, 532-545). Field receipts follow MultiSync v2: only a page-readable
 * result counts, and a clicked 发表 without a works record is unknown (shipinhao.js:6-9). The
 * 声明原创 flow (entry checkbox → declare-body-wrapper agreement checkbox → 声明原创 confirm
 * button) is ported from the 爱贝壳 1.7.0 short-video branch, where the vendor runs it
 * UNCONDITIONALLY and degrades any failure to a log (shipinhao.js:10-14, 2221-2224, 2270-2310) —
 * this plugin instead runs it only on an explicit `metadata.original === true` operator assertion
 * and type-fails instead of degrading. Anything the evidence does not pin is **Provisional** and
 * fails closed: a missing control is a loud typed refusal, never a silent no-op or a broad
 * fallback.
 */
import type { ChannelBrowserConfig } from '@gobing-ai/publish-harness/browser';
import { waitUntil } from '@gobing-ai/publish-harness/browser';
import type { IsAuthenticatedPredicate } from '@gobing-ai/ts-browser-automation';

/** Site-owned target slug; also the profile channel key (`SHP_PROFILE_DIR`). */
export const SHP_TARGET = 'shipinhao';

/**
 * Fixed home entry (recon-Grounded 2026-11-11): the Channels dashboard. Every direct
 * `/platform/post/<kind>` URL redirects here for a logged-in session — the per-op direct-create
 * URLs in the earlier Provisional table do not exist. The unified create surface lives at
 * `/platform/post/create`, reached by clicking the dashboard entry button (see
 * `SHP_CREATE_ENTRY_SELECTORS`); the publish flow performs that click-through after navigation.
 */
export const SHP_HOME_URL = 'https://channels.weixin.qq.com/platform';

/**
 * The post kinds the 发布 page offers (视频， 图文， 音乐， 音频). Declared operation names are
 * ASCII (`shortVideo` is the task 0296 freeze), one per platform post kind.
 */
export const SHP_OPERATION_NAMES = ['shortVideo', 'audio', 'image', 'music'] as const;
export type ShipinhaoOperationName = (typeof SHP_OPERATION_NAMES)[number];

/**
 * Dashboard create-entry button (recon-Grounded 2026-11-11): the dashboard offers exactly the
 * visible `发表视频` button; clicking it opens the unified `/platform/post/create` surface for
 * every post kind — the kind is determined by the media file fed to the single intake input.
 */
export const SHP_CREATE_ENTRY_SELECTORS = ['button:text-is("发表视频")'] as const;

/**
 * 添加描述 hard cap: the editor truncates any paste to exactly 100 plain-text characters
 * (Grounded live probe 2026-11-11 — a 6054-char paste retained exactly 100). Topic tags count
 * toward the same budget, so the body plain text is clipped to leave room for them.
 */
export const SHP_DESCRIPTION_MAX_CHARS = 100;

/**
 * Draft-save confirm dialog (Grounded live probe 2026-11-11): with 定时发表 active, clicking
 * 保存草稿 renders a dialog — "使用定时发表将无法保存草稿。若要保存草稿，需先取消定时发表。"
 * with visible buttons 不保存 (abort) / 保存 (proceed); the save only proceeds after clicking the
 * visible dialog's 保存. The vendor also ships this dialog as a permanently hidden 0×0 template,
 * so the rail anchors from the button side and requires a rendered box; absence = normal no-op.
 */
export const SHP_DRAFT_CONFIRM_DIALOG_TEXT = '使用定时发表将无法保存草稿';
export const SHP_DRAFT_CONFIRM_PROCEED_LABEL = '保存';

/**
 * Per-operation creation entries: ALL operations share the dashboard entry and the unified
 * `/platform/post/create` surface (recon-Grounded 2026-11-11 — the former per-kind
 * `/platform/post/<kind>` URLs redirect to the dashboard; the kept map keeps the flow's
 * per-operation seam while every entry is the same page).
 */
export const SHP_AUDIO_HOME_URL = SHP_HOME_URL;
export const SHP_IMAGE_HOME_URL = SHP_HOME_URL;
export const SHP_MUSIC_HOME_URL = SHP_HOME_URL;

/** Creation-page entry per declared operation (see {@link SHP_AUDIO_HOME_URL} for the caveat). */
export const SHP_HOME_URL_BY_OPERATION: Record<ShipinhaoOperationName, string> = {
    shortVideo: SHP_HOME_URL,
    audio: SHP_AUDIO_HOME_URL,
    image: SHP_IMAGE_HOME_URL,
    music: SHP_MUSIC_HOME_URL,
};

/**
 * Login/passport redirect marker. **Provisional**: shipinhao.js never observes a redirect URL; it
 * only gates on creator-form readiness (shipinhao.js:155-164). The readiness predicate below
 * carries the real gate: an unauthenticated visit is rejected by the missing creator form, not by
 * this regex alone.
 */
export const SHP_LOGIN_URL_RE = /(open\.weixin\.qq\.com|channels\.weixin\.qq\.com\/platform\/(login|scan))/;

/**
 * Root-readiness snapshot evaluated on the live page (vendor `rootReadinessSnapshot`,
 * shipinhao.js:514-529, and `accountRoots`, shipinhao.js:61-63): whether `wujie-app` is present,
 * whether its shadowRoot is attached, and the direct-evidence probe counts (`input[type="file"]`
 * plus the 描述/标题 placeholder probes, shipinhao.js:516-518). The publish flow refuses instead
 * of guessing a root from this snapshot — see `resolveCreatorRoot` in `src/flow.ts`.
 */
const ROOT_SNAPSHOT_SCRIPT = `(() => { // kk-shp-root-snapshot
    const wujieApp = document.querySelector('wujie-app');
    const shadow = wujieApp === null || wujieApp === undefined ? null : (wujieApp.shadowRoot ?? null);
    const count = (root, selector) => root === null ? 0 : root.querySelectorAll(selector).length;
    const directFileInputs = count(document, 'input[type="file"]');
    const directTextEvidence = count(document, '[data-placeholder*="添加描述"], input[placeholder*="标题"]');
    const shadowFileInputs = count(shadow, 'input[type="file"]');
    const shadowTextEvidence = count(shadow, '[data-placeholder*="添加描述"], input[placeholder*="标题"]');
    return JSON.stringify({
        wujiePresent: wujieApp !== null,
        shadowRootReady: shadow !== null,
        directFileInputs,
        directTextEvidence,
        shadowFileInputs,
        shadowTextEvidence,
    });
})()`;

/** Shape of {@link ROOT_SNAPSHOT_SCRIPT}'s JSON payload. */
export interface ShipinhaoRootSnapshot {
    wujiePresent: boolean;
    shadowRootReady: boolean;
    directFileInputs: number;
    directTextEvidence: number;
    shadowFileInputs: number;
    shadowTextEvidence: number;
}

/** Reads the root-readiness snapshot; a failed evaluate reads as "nothing ready yet". */
export async function readRootSnapshot(page: {
    evaluate: (script: string) => Promise<unknown>;
}): Promise<ShipinhaoRootSnapshot> {
    try {
        const parsed: unknown = JSON.parse(String(await page.evaluate(ROOT_SNAPSHOT_SCRIPT)));
        if (parsed !== null && typeof parsed === 'object') return parsed as ShipinhaoRootSnapshot;
    } catch {
        // navigation/replacement races read as not-ready; the callers poll and refuse at the deadline
    }
    return {
        wujiePresent: false,
        shadowRootReady: false,
        directFileInputs: 0,
        directTextEvidence: 0,
        shadowFileInputs: 0,
        shadowTextEvidence: 0,
    };
}

/**
 * Vendor wait ceilings (shipinhao.js:38-43), imported verbatim as this plugin's step budgets:
 * ROOT_WAIT_MS 30000 (root-resolve), FORM_WAIT_MS 90000 / PROCESSING_WAIT_MS 120000 (media), and
 * the cover ceilings COVER_PREVIEW_WAIT_MS 30000 / COVER_SAVE_WAIT_MS 60000. CONTROL_WAIT_MS 15000
 * is subsumed by the shared 30s step budget (`STEP_TIMEOUT_MS` in `src/flow.ts`).
 */
export const SHP_ROOT_WAIT_MS = 30_000;
export const SHP_FORM_WAIT_MS = 90_000;
export const SHP_PROCESSING_WAIT_MS = 120_000;
export const SHP_COVER_PREVIEW_WAIT_MS = 30_000;
export const SHP_COVER_SAVE_WAIT_MS = 60_000;

/**
 * Publishing-form controls. `videoInput`, `titleInput` and `descriptionEditor` are **Grounded**
 * (video accept kinds shipinhao.js:551-555, semantic upload regions shipinhao.js:565-568, unique
 * untyped input shipinhao.js:580-583, title candidates shipinhao.js:638-654, description editor
 * candidates shipinhao.js:669-674). The cover dialog/confirm shapes are **Grounded**
 * (shipinhao.js:1853-1871, 2145-2149); `saveButton` and the receipt URL shapes are
 * **Provisional** (the vendor never saves a draft — no 保存草稿 anywhere in shipinhao.js — and
 * never reads an id-bearing receipt: a clicked 发表 without a works record is unknown,
 * shipinhao.js:2326). All fail closed when absent or ambiguous.
 */
export const SHP_VIDEO_SELECTORS = {
    /**
     * Dashboard entry button into the unified create surface (see
     * {@link SHP_CREATE_ENTRY_SELECTORS}). Clicked once after navigation, before the form rails.
     */
    createEntry: SHP_CREATE_ENTRY_SELECTORS,
    /**
     * Video file input candidates, vendor priority: accept-kind (shipinhao.js:549-555) → semantic
     * upload region 上传视频/视频文件/选择视频 (shipinhao.js:565-568) → the single untyped
     * `input[type="file"]` (shipinhao.js:580-583; the flow refuses when more than one matches).
     */
    videoInput: [
        'input[type="file"][accept*="video"]',
        'input[type="file"][accept*=".mp4"]',
        'input[type="file"][accept*=".mov"]',
        'section:has(input[type="file"]):has-text("上传视频") input[type="file"]',
        'section:has(input[type="file"]):has-text("视频文件") input[type="file"]',
        'input[type="file"]',
    ],
    /** Short-title input candidates (短标题 exact → 填写标题 → any 标题; shipinhao.js:638-654). */
    titleInput: ['input[placeholder*="短标题"]', 'input[placeholder*="填写标题"]', 'input[placeholder*="标题"]'],
    /** Description editor candidates (添加描述 placeholders and the 话题和描述 editor; shipinhao.js:669-674). */
    descriptionEditor: [
        '[data-placeholder^="添加描述"]',
        '[placeholder^="添加描述"]',
        '[role="textbox"][aria-label^="添加描述"]',
        '[placeholder*="话题和描述"]',
    ],
    /**
     * Vertical-cover edit entry inside the 个人主页卡片 3:4 slot (shipinhao.js:2145). The flow
     * reads the slot's committed evidence and clicks this entry to open the cover dialog.
     */
    coverEditEntry: ['div.cover-preview-wrap > div'],
    /**
     * Cover dialog container candidates (vendor `findCoverControl`, shipinhao.js:2144-2149): the
     * flow requires the resolved dialog to hold an `input[type="file"]` before use. **Grounded
     * audio known-gap (live probe 2026-11-11)**: for AUDIO the container stays `visible:false` and
     * the slot stays `primary-loading` (auto-cover processing), so the vendor's visible-dialog
     * contract never materializes — a requested audio cover is a typed cover-attach failure, never
     * a silent skip. Daily presets request no cover for shipinhao rows.
     */
    coverDialog: [
        'div.cover-control-wrap',
        'div[class*="cover"][class*="dialog"]',
        'div[class*="cover"][class*="modal"]',
        '[role="dialog"]',
    ],
    /** File input inside the resolved cover dialog (vendor `findCoverControl` gate, shipinhao.js:2146-2148). */
    coverDialogFileInputSuffix: 'input[type="file"]',
    /**
     * Exact footer confirm label of the cover dialog, then the vendor fallback label set
     * (shipinhao.js:1853-1871): `div.finder-dialog-footer button` reading exactly 确认 first, then
     * 确认|完成|保存|应用|确定 — the crop-confirm → outer-submit ladder the vendor walks
     * (shipinhao.js:1883-1916) is driven by these labels only.
     */
    coverConfirmLabels: ['确认', '完成', '保存', '应用', '确定'],
    coverConfirmFooter: 'div.finder-dialog-footer button',
    /**
     * Agreement checkbox inside the 声明原创 dialog (shipinhao.js:2285-2287). **Grounded.**
     */
    originalAgreementCheckbox: 'div.declare-body-wrapper input[type="checkbox"].ant-checkbox-input',
    /** The 声明原创 confirm button label, matched on normalized exact text (shipinhao.js:2296-2299). **Grounded.** */
    originalConfirmLabel: '声明原创',
    /**
     * The exact-visible draft-save control. **Provisional** (task 0296 Design freeze): the vendor
     * never saves a draft (no 保存草稿 anywhere in shipinhao.js; without an explicit publish
     * request it leaves the form for human confirmation, shipinhao.js:2318-2319). `text-is`
     * exact match, no fallback; absence is a typed draft failure, never a manufactured draft and
     * never a publish click.
     */
    saveButton: ['button:text-is("保存草稿")'],
    /**
     * The publish button, exact 发表 on button/role=button (vendor `findPublishButton`,
     * shipinhao.js:2312-2316). **Grounded label; Provisional as this flow's rail** — reached only
     * on an explicit `publishStatus: 'public'`.
     */
    publishButton: ['button:text-is("发表")', '[role="button"]:text-is("发表")'],
} as const;

/** Keys of the selector map, for typed probes. */
export type ShipinhaoVideoSelectorKey = keyof typeof SHP_VIDEO_SELECTORS;

/**
 * The 音频 (audio-post) flow selectors: the video flow's rails (title, description editor,
 * 声明原创 dialog, cover dialog, submit rail) reused verbatim plus the unified intake ladder.
 * Recon-Grounded 2026-11-11: the create surface has ONE media intake (the video-accept input)
 * and no audio-accept input exists — feeding the .mp3 to that input morphs the form into the
 * audio post flow (title/description/cover/save rails all render post-upload). **Grounded.**
 */
export const SHP_AUDIO_SELECTORS = {
    ...SHP_VIDEO_SELECTORS,
    audioInput: ['input[type="file"][accept*="video"]', 'input[type="file"]'] as readonly string[],
} as const;

/**
 * The 音乐 (music-post) flow selectors: the audio flow's unified-intake ladder plus the cover
 * rails (music posts carry their own cover). Same intake evidence as audio; the music-specific
 * form rails stay **Provisional until live recon**, same fail-closed rule.
 */
export const SHP_MUSIC_SELECTORS: typeof SHP_AUDIO_SELECTORS = { ...SHP_AUDIO_SELECTORS };

/**
 * The 图文 (image-post) flow selectors: a multi-file image-input ladder plus the shared
 * text/submit rails. No cover rails are read — the platform owns the 图文 cover from the images
 * themselves, so the flow refuses an explicit cover for this operation instead of guessing a
 * slot. **Provisional until live recon**, same fail-closed rule.
 */
export const SHP_IMAGE_SELECTORS = {
    ...SHP_VIDEO_SELECTORS,
    imagesInput: [
        'input[type="file"][multiple]',
        'input[type="file"][accept*="image"]',
        'section:has(input[type="file"]):has-text("上传图片") input[type="file"]',
        'input[type="file"]',
    ] as readonly string[],
} as const;

/**
 * Receipt-shaped URLs. **Provisional**: the vendor never reads a receipt (a clicked 发表 without
 * a works record is `unknown`, shipinhao.js:2326), so these are the id-bearing works/record
 * shapes the task 0296 Design freeze names. Only shapes in this list count as receipts, and only
 * when they were not on screen before the click (fresh-signal rule) — a toast alone never
 * confirms, and disagreeing fresh ids are an ambiguous typed failure.
 */
export const SHP_RECEIPT_URL_RES = [
    /channels\.weixin\.qq\.com\/platform\/record\/detail\/[0-9a-zA-Z_-]+/,
    /channels\.weixin\.qq\.com\/platform\/post\/video\/[0-9a-zA-Z_-]+/,
    /channels\.weixin\.qq\.com\/platform\/post\/audio\/[0-9a-zA-Z_-]+/,
    /channels\.weixin\.qq\.com\/platform\/post\/image\/[0-9a-zA-Z_-]+/,
    /channels\.weixin\.qq\.com\/platform\/post\/music\/[0-9a-zA-Z_-]+/,
] as const;

/** Upload/processing ceiling for the video step (media ceiling — large local files, task 0296 freeze). */
export const SHP_UPLOAD_TIMEOUT_MS = 600_000;

/** Login deadline for the operator CLI and the session gate (shared harness default). */
export const SHP_LOGIN_TIMEOUT_MS = 180_000;

/**
 * Shipinhao-owned readiness predicate: no login redirect, and the creator form observed in its
 * real root — either the wujie-app shadowRoot with creator-form evidence inside it, or the
 * direct-document evidence probes (vendor `accountRoots` shipinhao.js:61-63 and
 * `rootReadinessSnapshot` shipinhao.js:514-529; the vendor reads a missing creator form as
 * not-ready, shipinhao.js:160-164). The wujie root can be late on a cold load, so the snapshot is
 * polled briefly (never a blind sleep) before the gate refuses. Shared by the publish preflight
 * and the operator profile CLI, so both apply one gate. The login-redirect regex is provisional
 * (see `SHP_LOGIN_URL_RE`); the creator-form probes carry the real gate.
 */
export const isShipinhaoAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (SHP_LOGIN_URL_RE.test(page.url())) return false;
    const ready = (snapshot: ShipinhaoRootSnapshot): boolean => {
        if (snapshot.wujiePresent)
            return snapshot.shadowRootReady && snapshot.shadowFileInputs + snapshot.shadowTextEvidence > 0;
        return snapshot.directFileInputs + snapshot.directTextEvidence > 0;
    };
    return waitUntil(async () => ready(await readRootSnapshot(page)), 15_000, 500);
};

/**
 * Site-owned config for the shared session check and operator CLI (ADR-032). The check opens the
 * publishing home (`SHP_HOME_URL`); the manifest `browserSession.homeUrl` is the same entry. The
 * publish preflight never forwards `checkHeadedOnly`: it is the operator CLI's setting, and a
 * refusal must never escalate to a headed window on its own.
 */
export const SHP_CONFIG: ChannelBrowserConfig = {
    channel: SHP_TARGET,
    homeUrl: SHP_HOME_URL,
    isAuthenticated: isShipinhaoAuthenticated,
    loginTimeoutMs: SHP_LOGIN_TIMEOUT_MS,
    checkHeadedOnly: false,
};
