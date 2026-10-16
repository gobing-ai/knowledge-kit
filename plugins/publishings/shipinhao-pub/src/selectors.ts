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
 * Fixed home entry (task 0296 Design freeze): the Channels short-video publishing page. Grounded
 * as the display entry only — shipinhao.js never navigates (it fills in place inside an
 * already-open assistant tab).
 */
export const SHP_HOME_URL = 'https://channels.weixin.qq.com/platform/post/video';

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
     * flow requires the resolved dialog to hold an `input[type="file"]` before use.
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
 * Receipt-shaped URLs. **Provisional**: the vendor never reads a receipt (a clicked 发表 without
 * a works record is `unknown`, shipinhao.js:2326), so these are the id-bearing works/record
 * shapes the task 0296 Design freeze names. Only shapes in this list count as receipts, and only
 * when they were not on screen before the click (fresh-signal rule) — a toast alone never
 * confirms, and disagreeing fresh ids are an ambiguous typed failure.
 */
export const SHP_RECEIPT_URL_RES = [
    /channels\.weixin\.qq\.com\/platform\/record\/detail\/[0-9a-zA-Z_-]+/,
    /channels\.weixin\.qq\.com\/platform\/post\/video\/[0-9a-zA-Z_-]+/,
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
