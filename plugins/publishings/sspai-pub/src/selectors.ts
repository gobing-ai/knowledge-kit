/**
 * sspai-pub selectors — every selector/URL/regex constant this channel resolves (task 0294).
 *
 * Grounding: the recovered extension adapter
 * `.spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/sspai.js` (82 lines)
 * pins the editor controls in its fill (sspai.js:26, 32, 50, 59) and its register map
 * (sspai.js:82): `textarea[placeholder="请输入标题..."]`, the first
 * `div[contenteditable="true"]`, and the page's first `input[type="file"]`. Its mechanism is UI
 * 填表 (sspai.js:5): title textarea value + contenteditable simulated `text/html` paste
 * (sspai.js:62-65) + cover file-input change dispatch (sspai.js:38-40); `a.editor-extra-button-preview`
 * (sspai.js:68) is a PREVIEW control only (sspai.js:15-16) and never satisfies a save.
 * Anything that evidence does not pin is **Provisional** and fails closed when absent — a missing
 * control is a loud typed refusal, never a silent no-op or a broad fallback.
 */
import { trySelectors } from '@gobing-ai/publish-harness';
import type { ChannelBrowserConfig } from '@gobing-ai/publish-harness/browser';
import type { IsAuthenticatedPredicate } from '@gobing-ai/ts-browser-automation';

/** Site-owned target slug; also the profile channel key (`SSPAI_PROFILE_DIR`). */
export const SSPAI_TARGET = 'sspai';

/**
 * Fixed home entry (task 0294 Design freeze). Grounded as the display entry only — the recovered
 * sspai.js never navigates (it runs inside an already-open editor tab), so no URL is pinned by it.
 */
export const SSPAI_HOME_URL = 'https://sspai.com/';

/**
 * Article-editor entry where the flow composes. **Provisional**: sspai.js never navigates
 * (sspai.js fills in place only), and the current editor route is unpinned; `/post/write` is the
 * historically documented entry (archived official guide, https://sspai.com/post/37790 — draft
 * saving is documented there historically only, not as current account UI). Every navigation to
 * this URL fails closed behind the readiness predicate below.
 */
export const SSPAI_EDIT_URL = 'https://sspai.com/post/write';

/**
 * Login/passport redirect marker. **Provisional**: sspai.js never observes a redirect URL; it
 * only infers logged-out state from the missing editor (sspai.js:60 「可能未登录」).
 * account.sspai.com is sspai's known SSO entry. The readiness predicate below carries the real
 * gate — a page body merely mentioning 登录 is never sufficient.
 */
export const SSPAI_LOGIN_URL_RE = /(account\.sspai\.com|\/(signin|login))/;

/**
 * Article-editor selectors. `titleInput`, `bodyEditor`, `coverInput` and `previewButton` are
 * **Grounded** (sspai.js:26, 50; 59; 32; 68 and the sspai.js:82 register map); `draftSave` is a
 * **Provisional** bounded candidate from the task 0294 Design freeze — exact visible
 * 保存草稿|保存, ordered resolution, no broad primary-button fallback, fail closed when absent.
 */
export const SSPAI_ARTICLE_SELECTORS = {
    /** Title textarea. **Grounded** (sspai.js:26, 50, 82). */
    titleInput: ['textarea[placeholder="请输入标题..."]'],
    /** Rich-text body editor (contenteditable, first on the editor page). **Grounded** (sspai.js:59, 82); missing there means 未登录 (sspai.js:60). */
    bodyEditor: ['div[contenteditable="true"]'],
    /**
     * Cover file input, scoped to the active article editor's form. **Grounded** that the source
     * takes the page's first `input[type="file"]` (sspai.js:32), but the task 0294 refine
     * correction freezes the scoping — a global first file input could target an unrelated
     * control, and the readback would then "verify" the wrong input. The contenteditable node
     * itself cannot host the input (the body paste replaces the editor's children), so the
     * editor-scoped shape is the form that contains the article editor. No page-first fallback.
     */
    coverInput: ['form:has(div[contenteditable="true"]) input[type="file"]'],
    /**
     * The exact-visible draft-save control(s). **Provisional** (task 0294 Design freeze; the
     * archived guide documents draft saving historically only — sspai.js never saves);
     * `text-is` exact match, most specific wording first, no other fallback. Absence is a typed
     * draft-save failure, never a manufactured draft.
     */
    draftSave: ['button:text-is("保存草稿")', 'button:text-is("保存")'],
    /**
     * The preview control. **Grounded** (sspai.js:68) — probed read-only for editor-chrome
     * capability evidence only; it is NEVER clicked in the draft path (sspai.js:15-16: the source
     * itself stops at preview, and preview is not a save).
     */
    previewButton: ['a.editor-extra-button-preview'],
} as const;

/** Keys of the selector map, for typed probes. */
export type SspaiArticleSelectorKey = keyof typeof SSPAI_ARTICLE_SELECTORS;

/**
 * Persisted draft receipt URL shapes. **Provisional**: sspai.js is a fill-only adapter and never
 * reads a receipt; these are the public-post and drafts-list id shapes the task 0294 Design
 * freeze names. Only shapes in this list count as receipts, and only when they were not on
 * screen before the save (fresh-signal rule) — a toast alone never confirms.
 */
export const SSPAI_RECEIPT_URL_RES = [/sspai\.com\/post\/\d+/, /sspai\.com\/me\/drafts\/\d+/] as const;

/** Login deadline for the operator CLI and the session gate (shared harness default). */
export const SSPAI_LOGIN_TIMEOUT_MS = 180_000;

/**
 * Sspai-owned readiness predicate: no login redirect and the site-owned title textarea (grounded,
 * sspai.js:26) plus contenteditable editor (grounded, sspai.js:59) attached — sspai.js:60 makes
 * the missing editor the logged-out marker. Shared by the publish preflight and the operator
 * profile CLI, so both apply one gate. The login-redirect regex is provisional (see
 * `SSPAI_LOGIN_URL_RE`); the editor-control probes carry the real gate, and body text mentioning
 * 登录 is never read.
 */
export const isSspaiAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (SSPAI_LOGIN_URL_RE.test(page.url())) return false;
    const title = await trySelectors(page, SSPAI_ARTICLE_SELECTORS.titleInput, { visible: false });
    if (!title.found) return false;
    return (await trySelectors(page, SSPAI_ARTICLE_SELECTORS.bodyEditor, { visible: false })).found;
};

/**
 * Site-owned config for the shared session check and operator CLI (ADR-032). The check opens the
 * article-editor entry (see `SSPAI_EDIT_URL`); the manifest `browserSession.homeUrl` stays the
 * fixed display entry `SSPAI_HOME_URL`. The publish preflight never forwards `checkHeadedOnly`:
 * it is the operator CLI's setting, and a refusal must never escalate to a headed window on its
 * own.
 */
export const SSPAI_CONFIG: ChannelBrowserConfig = {
    channel: SSPAI_TARGET,
    homeUrl: SSPAI_EDIT_URL,
    isAuthenticated: isSspaiAuthenticated,
    loginTimeoutMs: SSPAI_LOGIN_TIMEOUT_MS,
    checkHeadedOnly: false,
};
