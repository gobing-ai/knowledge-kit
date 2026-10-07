# xhs publish console — UI discovery (task 0199)

Measured live 2026-10-06 (~18:10 CST), draft-only, operator-attended cycle per ADR-025
(`check` ledger 06:55Z → clear; `publish` untouched). Evidence: `.spur/run/discovery/xhs-*.{json,png}`
(scratch). Walk scripts: `.spur/run/discovery/{walk,pierce,frames,shadow-probe}-xhs.ts` (read-only;
only mode-tab clicks + one local 1×1 png into the 图文 file input — never saved, never published).

## Entry & mode dispatch

- Entry URL `https://creator.xiaohongshu.com/publish/publish` ✅ matches `PUBLISH_URL`.
- Mode tabs: `div.creator-tab` ×4 render **3× (clones)**; only one on-screen instance is clickable →
  coordinate click on the viewport hit; matches the plugin's `countOnScreen`/`clickInViewport` seam.
- **Observed: mode is also URL-addressable** — after a tab click the SPA URL gains
  `?from=tab_switch&target=video|article|audio` (图文 stays bare). Not used by the plugin today;
  candidate for 0205 validated dispatch (preflight refusal stays name-based per ADR-029; the URL
  param is an observed fact, not a proposal).
- **Observed: tab bar locks once content enters the composer** — after `setInputFiles` on 图文,
  no `div.creator-tab` remains clickable (mode switch requires clearing the composer). Plugin flows
  that assume tab switching mid-flow would need composer reset; none currently do.

## Per-mode evidence

| Mode | Entry | First-screen controls (observed) | Success signal observed |
| --- | --- | --- | --- |
| 上传图文 | tab click (bare URL) | `input[type=file][accept=".jpg,.jpeg,.png,.webp"]` ✅, 上传图片, 文字配图 buttons | post-file form mounts: title `input[placeholder="填写标题会有更多赞哦"]`, body `div.tiptap.ProseMirror` ✅, topic/@/表情, activity cards |
| 上传视频 | `?target=video` | `input[type=file]` (accept matches `.mp4…` list ✅), dropzone | mode entry + input mount (no file set — attended item) |
| 写长文 | `?target=article` | 新的创作 entry; editor in an **iframe** (1 frame per mode observed; contents not pierced this cycle) | mode entry only (editor iframe contents = attended item) |
| 发播客 | `?target=audio` | 上传音频, 添加RSS订阅 buttons; modal flow expected (`creator-modal-sty` ✅ unprobed this cycle) | mode entry only (attended item) |

Bonus observation: a second file input with `accept=".pdf,.doc,.docx,.ppt,.pptx"` renders on the
filled 图文 form (document-embed affordance) — not in plugin constants; no impact on draft path.

## Draft / publish affordances (R3 — located, never acted on)

On the filled 图文 form, CDP `DOM.getDocument(depth:-1, pierce:true)`:

- Publish bar lives in a **closed shadow root** ✅ (validates `findShadowControl` seam):
  - `暂存离开` — `button.ce-btn.white` → `DRAFT_LABELS[0]` resolves ✅
  - `发布` — `button.ce-btn.bg-red` → `PUBLISH_LABELS[0]` resolves ✅
- No publish/submit/send control was clicked; no draft was saved; nothing created server-side.

## Drift list (R2)

| # | Item | Plugin current | Observed live | Impact on draft path |
| --- | --- | --- | --- | --- |
| 1 | Draft label | `暂存离开` (newest-first list) | `暂存离开` present in shadow bar | none — ✅ no drift |
| 2 | Publish label | `发布` | `发布` present in shadow bar | none — ✅ no drift |
| 3 | Tab bar | `div.creator-tab`, count 4, clones 3× | same; **locks after content entry** | flows never switch tabs mid-flow → none today; noted for 0205 |
| 4 | Image accept | `.png|.jpe?g|.webp` | `accept=".jpg,.jpeg,.png,.webp"` | ✅ matches |
| 5 | Video accept | mp4-family list | input present, accept matches list | ✅ (post-file flow unprobed) |
| 6 | Mode dispatch | name-based pre-browser refusal (ADR-029) | modes additionally URL-addressable via `target=` | none; informational for validated dispatch |
| 7 | 写长文 editor | light-DOM `div.tiptap.ProseMirror` selectors | first cycle saw an iframe; the 0205 attended probe (`.spur/run/discovery/xhs-long-article-editor.json`) found a single main-frame page with `div.tiptap.ProseMirror` and a light-DOM `暂存离开` | **resolved — no drift**: `ARTICLE_EDITOR` (`plugins/publishings/xhs-pub/src/flow.ts:50`) kept |

## Limits of the first cycle

Per the attended-cycle rail: 上传视频/发播客 post-file flows, the 长文 iframe editor internals, and
the draft-save toast (`保存成功`) success signal were **not** exercised this cycle. 0205's attended
fix walk must capture them before changing those flows. `PUBLISH_URL` published-marker
(`published=true`) untouched — no publish attempted.

**Resolved by 0205's attended walk (2026-10-05, evidence `.spur/run/discovery/`):**

- Draft-save signal: `暂存离开` clicked through the closed shadow root via CDP produced `保存成功` plus the
  `草稿箱(N)` counter, URL unchanged (`xhs-draft-signal-cdp.json`); a plain Playwright click times out
  (`xhs-draft-signal.json`). Wired as `DRAFT_TOASTS` + the counter read in `plugins/publishings/xhs-pub/src/flow.ts:72`.
- 写长文 editor: see drift #7 — main-frame tiptap, no drift.
- 上传视频 / 发播客 post-file draft saves: **excluded from unattended capture** — both are artifact-gated
  (the video note composer was observed behind its upload overlay, `xhs-video-editor.json`; 发播客 opens the
  `creator-modal-sty` upload modal, `xhs-podcast-dialog.json`). The plugin refuses a missing artifact
  before any browser opens (`validateModeInput`, `plugins/publishings/xhs-pub/src/index.ts:238`).
