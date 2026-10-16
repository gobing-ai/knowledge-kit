/**
 * xiaoyuzhou-pub selectors — every selector/URL/regex constant this channel resolves (task 0295).
 *
 * Grounding: the recovered extension adapter
 * `.spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/xiaoyuzhou.js` (83
 * lines, verified 2026-10-15 against the snapshot at
 * `~xprojects/knowledge-kit/.spur/run/yijianfa-source/platforms/xiaoyuzhou.js`) pins the studio
 * form controls in its fill (xiaoyuzhou.js:27, 55-56, 65): the audio `input#upload`, the title
 * `input[name="title"]`, and the Draft.js shownotes editor `div[data-contents="true"]`. Its
 * mechanism is UI 填表 (xiaoyuzhou.js:3-6): fileDatas[0] → DataTransfer → `files=` +
 * change/input dispatch (xiaoyuzhou.js:32, 46-50), a bare `.value` title write explicitly flagged
 * TODO(逆向存疑) in the source itself (xiaoyuzhou.js:57-58), and a text/html simulated paste into
 * the Draft.js editor (xiaoyuzhou.js:72-74). The source never saves (不点发布按钮，
 * xiaoyuzhou.js:6) and marks episode covers unsupported (xiaoyuzhou.js:17).
 * Anything that evidence does not pin is **Provisional** and fails closed when absent — a missing
 * control is a loud typed refusal, never a silent no-op or a broad fallback.
 */
import { trySelectors } from '@gobing-ai/publish-harness';
import type { ChannelBrowserConfig } from '@gobing-ai/publish-harness/browser';
import type { IsAuthenticatedPredicate } from '@gobing-ai/ts-browser-automation';

/** Site-owned target slug; also the profile channel key (`XYZF_PROFILE_DIR`). */
export const XYZF_TARGET = 'xiaoyuzhou';

/**
 * Fixed home entry (task 0295 Design freeze): the podcast studio at podcaster.xiaoyuzhoufm.com.
 * Grounded as the display entry only — the recovered xiaoyuzhou.js never navigates (it fills in
 * place inside an already-open studio tab).
 */
export const XYZF_HOME_URL = 'https://podcaster.xiaoyuzhoufm.com/';

/**
 * Login/passport redirect marker. **Provisional**: xiaoyuzhou.js never observes a redirect URL;
 * it only infers logged-out state from the missing audio input (xiaoyuzhou.js:28
 * 「可能未登录」). The readiness predicate below carries the real gate.
 */
export const XYZF_LOGIN_URL_RE = /(passport\.xiaoyuzhoufm\.com|\/(signin|login))/;

/**
 * Studio unsupported-browser page. **Provisional shape, official requirement**: the 小宇宙
 * podcaster studio is documented to require desktop Chrome 147+ and serves an
 * `unsupported-browser` page otherwise (observed bundled Chromium 155.0.8059.40 as
 * observed-only, never as a support claim). Hitting this page is an environment failure BEFORE
 * any upload: the operator runs the channel with `KK_BROWSER_CHANNEL=chrome` (the existing
 * `kkBrowserLauncher` reads it; no Playwright pin change).
 */
export const XYZF_UNSUPPORTED_URL_RE = /unsupported-browser/;

/**
 * Studio form selectors. `audioInput`, `titleInput` and `shownotesEditor` are **Grounded**
 * (xiaoyuzhou.js:27, 55-56, 65); `coverInput` and `saveButton` are **Provisional** bounded
 * candidates from the task 0295 Design freeze — fail closed when absent, no broad fallback.
 */
export const XYZF_AUDIO_SELECTORS = {
    /** Audio file input. **Grounded** (xiaoyuzhou.js:27); its absence there reads as maybe-unlogged (xiaoyuzhou.js:28). */
    audioInput: ['input#upload'],
    /** Title input. **Grounded** (xiaoyuzhou.js:55-56). */
    titleInput: ['input[name="title"]'],
    /** Draft.js shownotes editor. **Grounded** (xiaoyuzhou.js:65); missing there is a typed shownotes failure (xiaoyuzhou.js:66-70). */
    shownotesEditor: ['div[data-contents="true"]'],
    /**
     * Cover file control, scoped to the 上传封面/单集封面 section's file input. **Provisional**:
     * the vendor marks episode covers unsupported (xiaoyuzhou.js:17) and pins no selector, so
     * this stays a bounded semantic candidate — never a pretend-provenance claim and never a
     * silent skip; a missing control is a typed cover failure.
     */
    coverInput: ['form:has(div[data-contents="true"]) input[type="file"]:not(#upload)'],
    /**
     * The exact-visible draft-save control(s). **Provisional** (task 0295 Design freeze; the
     * source never saves — xiaoyuzhou.js:6, 18-19); `text-is` exact match, most specific wording
     * first, no other fallback. Absence is a typed draft-save failure, never a manufactured draft.
     */
    saveButton: ['button:text-is("保存草稿")', 'button:text-is("保存")'],
} as const;

/** Keys of the selector map, for typed probes. */
export type XiaoyuzhouAudioSelectorKey = keyof typeof XYZF_AUDIO_SELECTORS;

/**
 * Persisted draft receipt URL shapes. **Provisional**: xiaoyuzhou.js is a fill-only adapter and
 * never reads a receipt (it stops before publish, xiaoyuzhou.js:6, 18-19); these are the
 * episode/podcast id-bearing shapes the task 0295 Design freeze names. Only shapes in this list
 * count as receipts, and only when they were not on screen before the save (fresh-signal rule) —
 * a toast alone never confirms, and disagreeing fresh ids are an ambiguous typed failure.
 */
export const XYZF_RECEIPT_URL_RES = [
    /podcaster\.xiaoyuzhoufm\.com\/episode\/[0-9a-zA-Z]+/,
    /xiaoyuzhoufm\.com\/episode\/[0-9a-zA-Z]+/,
    /podcaster\.xiaoyuzhoufm\.com\/podcast\/[0-9a-zA-Z]+/,
] as const;

/** Upload/processing ceiling for the audio step (media ceiling — large local files, task 0295 freeze). */
export const XYZF_UPLOAD_TIMEOUT_MS = 600_000;

/** Login deadline for the operator CLI and the session gate (shared harness default). */
export const XYZF_LOGIN_TIMEOUT_MS = 180_000;

/**
 * Xiaoyuzhou-owned readiness predicate: no login redirect, no unsupported-browser environment
 * page, and the grounded audio input (xiaoyuzhou.js:27) plus title input (xiaoyuzhou.js:55)
 * attached — xiaoyuzhou.js:28 makes the missing audio input the maybe-unlogged marker. Shared by
 * the publish preflight and the operator profile CLI, so both apply one gate. The login-redirect
 * regex is provisional (see `XYZF_LOGIN_URL_RE`); the grounded-control probes carry the real gate.
 */
export const isXiaoyuzhouAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (XYZF_UNSUPPORTED_URL_RE.test(page.url())) return false;
    if (XYZF_LOGIN_URL_RE.test(page.url())) return false;
    const audio = await trySelectors(page, XYZF_AUDIO_SELECTORS.audioInput, { visible: false });
    if (!audio.found) return false;
    return (await trySelectors(page, XYZF_AUDIO_SELECTORS.titleInput, { visible: false })).found;
};

/**
 * Site-owned config for the shared session check and operator CLI (ADR-032). The check opens the
 * studio home (`XYZF_HOME_URL`); the manifest `browserSession.homeUrl` is the same entry. The
 * publish preflight never forwards `checkHeadedOnly`: it is the operator CLI's setting, and a
 * refusal must never escalate to a headed window on its own.
 */
export const XYZF_CONFIG: ChannelBrowserConfig = {
    channel: XYZF_TARGET,
    homeUrl: XYZF_HOME_URL,
    isAuthenticated: isXiaoyuzhouAuthenticated,
    loginTimeoutMs: XYZF_LOGIN_TIMEOUT_MS,
    checkHeadedOnly: false,
};
