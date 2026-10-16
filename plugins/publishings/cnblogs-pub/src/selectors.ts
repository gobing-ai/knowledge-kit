/**
 * cnblogs-pub selectors — every selector/URL/regex constant this channel resolves (task 0293).
 *
 * Grounding: the recovered extension adapter
 * `.spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/cnblogs.js` pins the
 * three editor controls in both its fill (cnblogs.js:22-23, 25-26, 30) and its register map
 * (cnblogs.js:35-37): `input#post-title`, `textarea#md-editor`, optional `textarea#summary`.
 * Anything that evidence does not pin is **Provisional** and fails closed when absent — a missing
 * control is a loud typed refusal, never a silent no-op or a broad fallback.
 */
import { trySelectors } from '@gobing-ai/publish-harness';
import type { ChannelBrowserConfig } from '@gobing-ai/publish-harness/browser';
import type { IsAuthenticatedPredicate } from '@gobing-ai/ts-browser-automation';

/** Site-owned target slug; also the profile channel key (`CNBLOGS_PROFILE_DIR`). */
export const CNBLOGS_TARGET = 'cnblogs';

/**
 * Post-edit entry where the article flow composes. **Provisional**: cnblogs.js runs inside an
 * already-authenticated editor tab and never navigates (cnblogs.js fills in place only).
 */
export const CNBLOGS_EDIT_URL = 'https://i.cnblogs.com/posts/edit';

/**
 * Login/passport redirect marker. **Provisional**: cnblogs.js never observes a redirect URL;
 * account.cnblogs.com/signin is cnblogs' known SSO entry. The readiness predicate below carries
 * the real gate.
 */
export const CNBLOGS_LOGIN_URL_RE = /(account\.cnblogs\.com\/signin|\/signin)/;

/**
 * Article-editor selectors. The first three keys are **Grounded** (cnblogs.js:22-23, 25-26, 30
 * and the cnblogs.js:35-37 register map); `categoryPanel`, `draftSave` and `publishButton` are
 * **Provisional** semantic candidates from the task 0293 Design freeze — exact visible
 * 保存草稿|存为草稿 and 发布|发布博文, bounded ordered resolution, no broad primary-button
 * fallback, fail closed when absent.
 */
export const CNBLOGS_ARTICLE_SELECTORS = {
    /** Title input. **Grounded** (cnblogs.js:22, 25, 36). */
    titleInput: ['input#post-title'],
    /** Markdown body textarea. **Grounded** (cnblogs.js:23, 26, 36); value + input events, never innerHTML. */
    bodyEditor: ['textarea#md-editor'],
    /** Optional digest/summary textarea. **Grounded** (cnblogs.js:30, 36); filled only when a digest is requested. */
    summaryInput: ['textarea#summary'],
    /**
     * Category panel holding the account's existing categories as label-associated checkboxes.
     * **Provisional** panel node (cnblogs.js never touches categories); the checkbox/label
     * matching inside it is structural, not guessed.
     */
    categoryPanel: ['#cateOwner', '#categories'],
    /**
     * The exact-visible draft-save control(s). **Provisional** (task 0293 Design freeze);
     * `text-is` exact match, most specific wording first, no other fallback.
     */
    draftSave: ['button:text-is("保存草稿")', 'button:text-is("存为草稿")'],
    /**
     * The exact-visible publish control(s). **Provisional** (task 0293 Design freeze); 发布博文
     * first so the specific control wins over the bare 发布 wording — never a primary-button or
     * submit fallback.
     */
    publishButton: ['button:text-is("发布博文")', 'button:text-is("发布")'],
} as const;

/** Keys of the selector map, for typed probes. */
export type CnblogsArticleSelectorKey = keyof typeof CNBLOGS_ARTICLE_SELECTORS;

/**
 * Persisted draft/post receipt URL shapes. **Provisional**: cnblogs.js is a fill-only adapter and
 * never reads a receipt; these are the edit-URL-gaining-`postId` and the public
 * `/p/<id>.html` shapes the task 0293 Design freeze names. Only shapes in this list count as
 * receipts, and only when they were not on screen before the save (fresh-signal rule).
 */
export const CNBLOGS_RECEIPT_URL_RES = [
    /i\.cnblogs\.com\/posts\/edit\?[^\s#]*postId=\d+/,
    /cnblogs\.com\/[^/\s]+\/p\/\d+\.html/,
] as const;

/** Login deadline for the operator CLI and the session gate (shared harness default). */
export const CNBLOGS_LOGIN_TIMEOUT_MS = 180_000;

/**
 * Cnblogs-owned readiness predicate: no login redirect and the site-owned Markdown editor
 * reachable (the grounded title input). Shared by the publish preflight and the operator profile
 * CLI, so both apply one gate. The login-redirect regex is provisional (see
 * `CNBLOGS_LOGIN_URL_RE`); the title-input probe carries the real gate.
 */
export const isCnblogsAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (CNBLOGS_LOGIN_URL_RE.test(page.url())) return false;
    return (await trySelectors(page, CNBLOGS_ARTICLE_SELECTORS.titleInput, { visible: false })).found;
};

/**
 * Site-owned config for the shared session check and operator CLI (ADR-032). The check opens the
 * post-edit entry (see `CNBLOGS_EDIT_URL`). The publish preflight never forwards
 * `checkHeadedOnly`: it is the operator CLI's setting, and a refusal must never escalate to a
 * headed window on its own.
 */
export const CNBLOGS_CONFIG: ChannelBrowserConfig = {
    channel: CNBLOGS_TARGET,
    homeUrl: CNBLOGS_EDIT_URL,
    isAuthenticated: isCnblogsAuthenticated,
    loginTimeoutMs: CNBLOGS_LOGIN_TIMEOUT_MS,
    checkHeadedOnly: false,
};
