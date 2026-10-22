# wechatmp (mp.weixin.qq.com) console UI discovery (task 0200) — first pass, four modes

> **Re-measured second pass (task 0200, 2026-10-06, walks v1–v5, evidence `.spur/run/discovery/wechatmp-walk*.json` + `wechatmp-*.png`).** Baseline below stands; deltas: menu items enumerated (文章/选择已有内容/贴图/视频/转载/播客/直播 未绑定 — no hrefs, JS dispatch; 视频/播客 popups land on the SAME appmsg v2 route, createType 5/7 — W3/W6 confirmed); title is a visible ProseMirror `div[data-placeholder*="标题"]` and the hidden mirror `textarea#title` syncs live (typed visible title → mirror value verified identical); **文章 draft-save signal measured: URL rewrites from `appmsg_edit_v2&isNew=1…createType=0` to `appmsg_edit&action=edit…&appmsgid=100000899` — no toast** (W11: detect save success by URL `appmsgid=`, not toasts); static file inputs are hidden: toolbar image insert accepts `image/gif,image/jpeg,image/jpg,image/png,image/svg,image/webp` (W8 confirmed verbatim), a second input accepts `image/bmp, image/png, image/jpeg, image/jpg, image/gif, image/webp`; 视频/播客 mode entry AUTO-OPENS a vue video/audio picker (`div#vue_app ul.more-video__list*`) that intercepts pointer events over the editor — artifact-gated at ENTRY, 本地上传 sub-path exists but nested unattended attach did not complete (channels-binding suspected, cf. `直播 未绑定`); 贴图 image attaches via the hidden toolbar input, `保存为草稿` click produced no observable effect (no toast/dialog/URL change — attended).

> **Third pass — attended items resolved (task 0200, 2026-10-06 evening, walks v6–v9, evidence `.spur/run/discovery/wechatmp-{tietu,tietu2,attended,tietu-final,tietu-final2,tietu-final3,vp}.json`, scripts `probe-wechatmp-tieTu.ts`, `walk-wechatmp6–9.ts`).** (1) **贴图 保存为草稿 mystery solved**: the click was never a no-op — it opens a save-settings dialog whose validation blocks save with inline prompts `请在这里输入标题` / `请输入作者` / `文字消息正文不能为空` (a 0/1000 counter field). Earlier walks saw "no observable effect" because the blocking dialog is the effect. (2) **The 贴图 route never gains `appmsgid`** (checked after 4 save attempts) — for 贴图 the plugin draft signal is the dialog validation state plus the 草稿箱 row (conclusion 1 below stands; the W11 URL-rewrite signal is 文章-only). (3) **贴图 title is a TEXTAREA** `textarea.frm_input.js_title` (placeholder `请在这里输入标题（选填）` despite being enforced) — the §3 `input.frm_input.js_title` shape is 文章-only. (4) **视频 picker unchanged in kind**: entry still auto-opens the vue picker (`div#vue_app`/`more-video` present; Vue 3 — no `data-v` attrs, so data-v probes false-negative), but `本地上传` is reachable in DOM and **no channels/直播 binding hints appeared this pass** — the sub-path remains artifact-gated and attended-only. (5) Session token `860958155` persisted across every walk; **no draft was created** (dialog left unclosed = nothing saved).

> **Fourth pass — the 文章 field rail completed (operator walk 2026-10-10, attended, draft-only).**
> This supersedes the 2026-09-29 reading that 原创/赞赏/原文链接/创作来源 must stay manual. Every
> settings row has ONE shape: open it from the row control, act in the dialog, click `确定`.
> Measured: **原创** (`>` → `确定`; no 声明类型 choice and no 赏账户 search is required), **赞赏**
> (`>` → `确定`; the 赞赏账户 defaults from 作者 and only needs filling when the platform leaves it
> empty), **合集** (`>` → `请选择合集` → the collection name → `确定`; the real collection is
> 「每日AI资讯」, *not* the column name 「AI 乱炖」), **原文链接** (`>` → the URL → `确定`), **创作来源**
> (`>` → `个人观点，仅供参考` → `确定` — the operator's own stance, not the platform's AI-generation label).
> **作者** is the editor's own `请输入作者` field (`input#author`); filling it is what makes 赞赏
> default correctly downstream. **上传音频** is a real form, not an iframe: `音频` menu → `上传音频` →
> audio file → `上传封面` → cover file → title → the 《公众平台音频上传服务规则》 acknowledgement →
> `保存` → the list reopens with the new material first (`默认第一个`) → `插入`, which places it at the
> **body start**. **封面** comes from `从图片库选择` (`a.js_imagedialog`) → first item → `下一步` → `确认`,
> i.e. the image the same run uploaded as the audio material's cover. `一键排版` **is** to be applied
> (→ `匹配目标格式`); a build that renders no option set is a reported warning, never a silent skip.
> The upload form's inner controls (file inputs, title field, acknowledgement checkbox, 保存) were not
> individually re-probed on this pass, so `wechatmp-pub`'s selectors for them are candidate shapes
> resolved by visible label text; the flow reports each by name when one misses.

> **Fifth pass — committed-state repair (task 0260, measured 2026-10-13, evidence `.spur/run/wechat-drift-task/measure-20261013/*.json`, repaired 2026-10-14).**
> The 文章 rail now reads the REQUESTED committed editor state before AND after each settings step
> (runtime DOM properties only, never HTML attributes): 原创 = `#js_original`/`.js_ori_setting_checkbox`
> checked, 赞赏 = `#js_reward_setting_area .js_reward_setting_checkbox` checked, 创作来源 =
> `#js_claim_source_area` checkbox checked + `.js_claim_source_selected` text equal to the requested
> stance; only the exact committed value establishes success — missing, throwing or unverifiable
> probes are named warnings (`…未生效，请手动设置`), never truthy defaults. An unclosable dialog yields
> per-step residual diagnostics and the 保存为草稿 click refuses through any unresolved overlay
> (inventory named in the failure). Audio reuse is identity-checked (exact whitespace/NBSP-normalized
> title → data-mediaid/thumb identity); prefix or duplicate titles are refused, never first-item;
> an upload only succeeds after the saved row appears AND the body node verifies at top. Real-Chromium
> fixture regressions (`tests/fixtures/wechatmp-dom-runner.ts` + `tests/wechatmp-dom.test.ts`) execute
> the production expressions against synthetic DOM built from these shapes — they caught one real
> defect: a mixed-engine selector union (`text=上传音频, button:has-text(…)`), which Playwright parses
> as pure CSS and matches nothing; the upload/cover clicks now click the `trySelectors` winner.

> **Sixth pass — the 2026-10-21 draft's warnings, measured (five read-only probes on the live
> session, evidence `.spur/memory/evidence/20261021-wechatmp/wechatmp-probe{,2,3,4,5}-20261021.json`
> + `wechatmp-step-*.png`; probe scripts were scratch and are not kept).** The saved draft carried
> `音频上传未成功` / `一键排版 … no 匹配目标格式 option` / `原创声明未生效` / `创作来源未生效` /
> `原文链接 dialog` warnings. Every committed-state probe still exists (`#js_original`,
> `.js_ori_setting_checkbox`, `#js_reward_setting_area`, `#js_claim_source_area`,
> `.js_claim_source_selected`, `#author`, `textarea#title`, `div[data-placeholder*="标题"]`), so the
> rail did not lose its ids — the entry paths and two file-input shapes changed:
>
> 1. **Audio upload (fixed 2026-10-21, `flow.ts` `AUDIO_UPLOAD_INPUT`).** 音频 toolbar item
>    (`li#audio_music_plugin_btn`) → dropdown → the 音频 item → `.weui-desktop-dialog` "插入音频"
>    (tabs `从素材库选择` / `从视频号选择` / `上传音频`, a `搜索音频` field, per-row checkboxes,
>    `插入`/`取消`) → `上传音频` opens a SECOND dialog: "上传音频 … 上传文件 · 封面 上传封面 ·
>    使用账号头像 · 标题 0/64 · 我已阅读并同意《公众平台音频上传服务规则》(already checked) · 保存".
>    The audio file input carries **no `accept` attribute at all**, and the cover input carries
>    `image/bmp, image/png, image/jpeg, image/jpg, image/gif, image/webp` (no slash-terminated
>    `image/`). Every accept-qualified candidate in the old lists missed both, which is why no audio
>    material uploaded — and with it the draft lost the player, the audio cover, and the library cover
>    the 封面 step reuses (`lib 素材库` still stops at 2026-10-19, so 10-20 and 10-21 never uploaded).
>    Proof the new candidates win: probe 5 reports
>    `.weui-desktop-dialog input[type="file"]:not([accept*="image"])` found — the visible dialog input
>    with `accept=''`.
> 2. **一键排版 is inert in this build (behaviour unchanged, message corrected).** With a body in the
>    editor, `div#ai_layout_container > div.ailayout-btn_wrp` is visible and clickable, and no option
>    set ever renders (only a hidden `ailayout-edu_tips` onboarding block); the earlier 2026-10-13
>    reading "no control at all" is superseded. Nothing programmable is left to click, so the stage
>    now names that finding instead of hedging about the body's formatting.
> 3. **Rail entry shapes measured, repair not landed.** 原创 opens from
>    `#js_original i.read-more__icon__more-inactive` into a dialog ("原创 声明类型 文字原创/无需声明 ·
>    作者 · 白名单 · 快捷转载 · 我已阅读并同意《微信公众平台原创声明及相关功能使用协议》(the checkbox is
>    present but hidden) · 确定/取消"); 创作来源 opens from `#js_claim_source_area .allow_click_opr`
>    into a dialog whose 声明类型 radios are `内容由AI生成` / `素材来源官方媒体/网络新闻` /
>    `内容剧情演绎，仅供娱乐` / **`个人观点，仅供参考`** (the daily stage's stance exists) /
>    `健康医疗分享，仅供参考` / `投资观点，仅供参考` / `无需声明`, confirmed with **`确认`**;
>    原文链接's `allow_click_opr` ("未添加") did nothing in an empty editor and the row's
>    `input.frm_checkbox.js_url_checkbox` is visible but not `check()`-able by Playwright, so that
>    entry still needs a measured walk (click the row label, then read where the URL field appears).
>    These three remain the draft's visible gaps (原创 unchecked → 赞赏/付费 disabled).
>
> **Task 0318 repair (2026-10-21, live editor acceptance passed).** The rail now opens 原创 from
> `#js_original .setting-group__content-info` (fallback: its `.setting-group__title`), keeps the
> 文字原创 radio, clicks `label.original_agreement` only when its hidden checkbox is unchecked, and
> commits with `确定`. 创作来源 opens from `#js_claim_source_area .allow_click_opr`, selects the exact
> requested radio label, and commits with its own `确认`; a missing stance is a named skip and the
> dialog is swept. Real-Chromium fixtures reproduce the old entry failure and pre-checked agreement
> toggle failure, then pass the repaired original/reward/claim sequence and unavailable-stance case.
> **原文链接 measured before repair:** `#js_article_url_area .js_article_url_allow_click` opens a
> popover outside `.weui-desktop-dialog`. Its `.popover_inner` contains
> `.popover-article-setting__content input.js_url[name="source_url"]`; confirm is
> `a.jsPopoverBt` with exact text `确定` (not a button). After confirm, the row's
> `input.js_url_checkbox` is checked and `.article_url_setting` equals the requested URL.
> Label/span clicks did nothing; clicking the checkbox was blocked by the open popover. Evidence:
> `.spur/memory/evidence/20261021-wechatmp/0318-url-measure.json` (saved=false, published=false).
> Session reuse requires restoring `storage-state.json` cookies and localStorage, as the channel
> launcher already does; a raw persistent-profile launch alone produced a false login failure.
> The live pass also found TWO hidden 原创 switch inputs within `#js_original` (false/true). The
> committed probe now reads the input whose switch parent belongs to the visible row branch, so the
> hidden undeclared template cannot mask a successful declaration. 创作来源's radio labels wrap a nested
> text span; the rail matches that exact descendant text within a radio label. URL confirmation closes
> asynchronously: the rail waits for the popover to hide before reading the row or sweeping overlays.
> Live acceptance (`.spur/memory/evidence/20261021-wechatmp/0318-live-acceptance.json` and local
> screenshot `.spur/run/0318-live-acceptance.png`) ran the production rail on a fresh editor and replayed
> it: original/reward checked, claim checkbox checked with exact requested stance, URL checkbox checked
> with exact requested URL, no warnings, and no dialogs/popovers left. No draft was saved or published;
> today's saved article was untouched. Offline Chromium covers delayed/refused URL commit, moved field,
> URL/setting skip, both original row templates, hidden/pre-checked agreement, and unavailable stance.
>
> Method: the plugins' own Chromium (Playwright 1.55 build) on the real profile dir
`~/.config/kk/browser-profiles/wechatmp`, headed, driven by `.spur/run/discovery/wechatmp-walk.ts`.
Operator attended and scanned the login QR in-window (the stored session had expired).
**Draft-only:** no publish control was clicked and **no draft has been saved yet** (the save signal is
still to capture). Raw evidence: `.spur/run/discovery/wechatmp-*.{json,png}`.

## 1. Console shape

| Element | Verified value |
| --- | --- |
| Console entry | `https://mp.weixin.qq.com/` → redirects to `/cgi-bin/home?t=home/index&lang=zh_CN&token=<N>` when logged in |
| **Session token** | every console route carries `&token=<N>` (observed `302104224`); the token is per-session, so stored console URLs cannot be reused verbatim |
| Login | itself **iframed** (`open.weixin.qq.com/connect/qrconnect?appid=…`); a QR scan is the only path |
| Login detection | body text is unusable (`登录` appears on the console too — it false-negatived a successful login). Detect by URL/`token=` or by the absence of a `qrconnect` frame |
| Creation menu | `div.new-creation__menu-item` with `div.new-creation__menu-title` labels; opened from the console's 新的创作 control |
| **Editor opens in a NEW TAB** | after clicking a creation type `ctx.pages()` becomes 2; the entry page stays on the console home. Any walker must follow the newest page |
| Profile locking | one Chromium per profile dir; a stale `SingletonLock` must be cleared only after confirming no Chromium holds the profile |

## 2. The four modes we support (operator decision — 选择已有内容 / 转载 / 直播 are out of scope)

Route template (verified for all four):

```
https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1
    &type=77&createType=<N>&token=<session>&lang=zh_CN&timestamp=<ms>
```

| Mode | `createType` | Landed on |
| --- | --- | --- |
| 文章 | **0** | article editor (§3) |
| 贴图 | **8** | same editor route; **title optional** (`请在这里输入标题（选填）`) |
| 视频 | **5** | same editor route |
| 播客 | **7** | same editor route |

## 3. Editor anatomy (verified on the 文章/贴图/视频/播客 editor tabs)

| Part | Verified selector / value |
| --- | --- |
| Title | `input.frm_input.js_title.js_counter.js_field.js_article_title`, placeholder `请在这里输入标题` (文章) / `请在这里输入标题（选填）` (贴图) |
| Author | `input.frm_input.js_author.js_counter.js_field`, placeholder `请输入作者` |
| **Body** | **`div.ProseMirror` in the MAIN frame** — MP has moved off the iframe UEditor. A second `div.ProseMirror.ProseMirror-focused` exists, plus a reprint-tips input (`original_primary_tips_input js_reprint_r`) |
| Image insert | `input[type=file]` `accept="image/gif,image/jpeg,image/jpg,image/png,image/svg,image/webp"` |
| **Save as draft** | **`保存为草稿`** |
| **Publish** | **`发表`** (never clicked) |
| Other bar controls | `返回原草稿`, toolbar `图片 视频 音频 超链接 小程序 模板 投票 搜索 地理位置`, plus `文档导入`, `新建内容`, `历史版本` |
| Only child frame | an article **preview** (`/s?__biz=…`), not an editor |

## 4. Drift list vs the current `wechatmp-pub` (fix candidates for task 0205)

| # | Drift item | Evidence | Impact |
| --- | --- | --- | --- |
| W1 | The editor body is **ProseMirror in the main frame**; the plugin's `setInnerHtml`/iframe-body assumption targets the retired UEditor UI | §3 | body insertion can never land |
| W2 | Console routes need the **session `token`**; a stored editor URL is not reusable | §1 | deep-linking the editor fails |
| W3 | Creating a type opens the editor in a **new tab** | §1 | a flow bound to one page object never sees the editor |
| W4 | The draft control is **`保存为草稿`** and publish is **`发表`** | §3 | the plugin's save/publish step targets the wrong affordance |
| W5 | Title is **required for 文章** but optional for 贴图 (placeholder differs) | §3 | a missing title must fail before a browser opens, per mode |
| W6 | Four modes need **mode dispatch** (`createType` 0/8/5/7) — the plugin implements one path today | §2 | 3 of 4 modes are unreachable |
| W7 | 视频/播客 carry their own required artifacts (a video file; audio **plus** a cover image) | xhs-analogous, still to verify on MP | Content must carry them and fail fast |
| W8 | The image input accepts `svg`/`webp` in addition to raster formats | §3 | format validation would wrongly reject valid inputs |
| W9 | Login is iframed and body-text login checks false-negative | §1 | a session check can report "logged out" on a live console |
| W10 | `文档导入` and `历史版本` exist in the editor (an import path like xhs's 导入链接) | §3 | another route to decide on — operator excluded the xhs equivalent |

## 5. Draft state, auto-save, and the platform's own validation

Measured while attempting one draft save on 文章:

| Observation | Value |
| --- | --- |
| **Auto-save** | the editor continuously auto-saves (`自动保存` toasts) and records an entry in 历史版本 (`10-05 12:41 · 网页版 · 手动保存`) |
| Draft box | the draft appears in 草稿箱 with actions `编辑 / 删除 / 发表` |
| Validation | the platform refuses publication with **内容不完整，无法发表** and the hint **图文内容不完整 请补充封面图、标题或者正文** |
| Publish control | `发表` (`class="mass_send"`, bottom bar, right of `保存为草稿` and `预览`) — **never activated** |

**So MP has two distinct gates the plugin must model:** (a) a draft exists as soon as the editor
auto-saves — an explicit `保存为草稿` is a manual checkpoint, not the only path; and (b) MP itself
validates completeness (cover + title + body) before `发表`, so a channel implementation can rely on
that refusal for the draft-vs-publish boundary but must fail fast on the *required fields* earlier.

**Incident note (for the record).** On the 文章 save attempt the walker clicked at CSS (858, 657),
which is the empty editor body — the action bar sits at y≈1047. No publish control was reached: the
screenshot shows the untouched bar (`保存为草稿` / `预览` / `发表`), and the draft box independently
reports the item as 内容不完整，无法发表. The walker's control targeting is being corrected to use the
element's own box (and its x), not a y-only probe.

## 5.1 Per-mode save signal and artifact gating (measured)

All four modes were driven with the walker's hit-test-verified save control (the click is refused
unless `elementFromPoint` at the control's centre resolves back to `保存为草稿`):

| Mode | Save bar present before an artifact? | Draft signal observed |
| --- | --- | --- |
| 文章 | **yes** — `保存为草稿` at (1591,1473,96x34), `预览` (1701,1473), `发表` (1811,1473, `mass_send`) | verified: the 草稿箱 row appeared/updated — `kk-discovery-文章 请忽略 … 更新于 13:12` (matching the click time), with the platform note 图文内容不完整 请补充封面图、标题或者正文 |
| 贴图 | yes | the bar was clicked on the same coordinates, but **no titled draft row appeared** without an image attached — 贴图 needs ≥1 image (the image input `accept="image/gif,image/jpeg,image/jpg,image/png,image/svg,image/webp"` exists on the editor) |
| 视频 | **no** — the walker reported `REFUSED: no on-screen 保存为草稿 control resolved` | the save bar itself is **artifact-gated**: it appears only after the video is attached |
| 播客 | no (same shape as 视频) | same gating; audio + cover are required before the bar is usable |

**Signal conclusions for the plugin:**

1. **The reliable MP draft signal is the 草稿箱 row keyed by title with its `更新于` timestamp** — not
   a URL change (the editor URL is unchanged on 贴图; 文章 only shifted to its internal
   `action=edit` route) and not a toast (`系统繁忙，请稍后再试` appears routinely and is **not** a save
   failure indicator; `自动保存` fires on any edit).
2. **MP auto-saves continuously** (`自动保存` toasts + 历史版本 entries), so an untitled autosave can
   exist without a titled row. A plugin that must produce an identifiable draft needs the title set
   and should verify by reading the draft box, not by scraped toasts.
3. **The save bar is artifact-gated for 视频/播客.** The plugin must upload the media *before* it can
   even see the save control — so the flow order is: attach artifact → fill title/body → save, and a
   missing artifact must be caught by the plugin before it opens a browser.
4. **MP enforces completeness itself** (封面图 + 标题 + 正文), which the plugin can lean on for the
   draft/publish boundary but must not rely on for required-field validation (fail fast instead).

**Drafts left on the account (all deletable, none published):** `kk-discovery-文章 请忽略` (13:12) and
untitled auto-saves at 13:10 / 12:41; the platform marks each 内容不完整，无法发表.

## 5.2 文章 full field inventory, and the 视频/播客 workflows

### 文章 — every field the editor exposes

| Field | Control (verified) | Constraint |
| --- | --- | --- |
| 标题 | **`div.ProseMirror[data-placeholder="请在这里输入标题"]`** (authoritative) mirrored by `textarea#title.frm_input.js_title.js_counter` | **0/64** |
| 作者 | `input#author.frm_input.js_author` — labelled **原创：** | **0/8**, settings take effect only after 原创 verification (`以下设置仅在原创校验成功后生效`) |
| 正文 | `div.ProseMirror.ProseMirror-focused` (no data-placeholder) | 正文字数 counter |
| 摘要 | `textarea#js_description.frm_textarea.js_desc.js_counter` (`选填，不填写则默认抓取正文开头部分文字…`) | **0/120** |
| 封面 | **no file input** — panel offers `修改` / `换一张` / **从正文选择** (`a.js_selectCoverFromContent`) / `从图片库选择` (`js_imagedialog`) / `微信扫码上传` (`js_imageScan`) / `AI 配图` (`js_aiImage`), and states **默认首图为封面** | max 1 image |
| 留言 | `input.weui-desktop-switch__input.js_interaction_setting` (留言自动精选公开 / 不开启留言) | switch |
| 合集 | `input.frm_checkbox.js_article_tags` | picker |
| 原文链接 | `input.frm_checkbox.js_url_checkbox.js_field` | picker |
| 创作来源 | `input.frm_checkbox.js_claim_source` | picker |
| 平台推荐 | `input.frm_checkbox.js_not_recommend` + radios `not_recomment_0/1` (开启/不开启 内容不会被推荐，但不影响用户收到推送) | toggle |
| 原创声明 | radios `import_finder_0/1` (开启/不开启) + `open_underline_1/2` | toggle pair |
| 赞赏 | hidden `js_can_reward` / `js_can_open_reward` / `js_author_username` | reward settings |
| Settings panel | `a.tool_bar__fold-btn.fold` → **文章设置** (collapsed by default) | container for the above |
| Bar | `保存为草稿` · `预览` · `发表` (`mass_send`) | — |
| Toolbar extra | `文档导入` (import a document) | — |

**Two traps measured here:**
1. **Filling `textarea#title` does nothing** — the draft still saved with an empty title (draft row showed 内容不完整). Typing into the *title ProseMirror block* set both the block and the mirror (`title-mirror` read back `kk-complete-article 完整草稿`). The textarea is a form mirror, not the input.
2. **The cover has no file input.** The panel's own text: `拖拽或选择封面 · 默认首图为封面 · 修改 / 换一张 / 从正文选择 / 从图片库选择 / 微信扫码上传 / AI 配图 … 最多添加1张图片`. The panel's image list is **not** `<img>`-based (a probe found `panels: 5, imgs: 0`), so selecting from `从正文选择` needs iteration on that widget.

**State reached with every other field filled** (draft `kk-complete-article 完整草稿`, 更新于 14:25): title (block + mirror), author, digest (≤120), body text, body images — the platform's only remaining complaint is **请补充封面图**.

### 视频 and 播客 — artifact-gated modals, not a different save concept

Both modes **do** expose the same bar (`保存为草稿` · `预览` · `发表`), but each starts behind a **modal media dialog that covers the bar** — which is why an earlier save attempt returned `REFUSED: no on-screen 保存为草稿 control resolved` (the hit test refused to click through the modal):

| Mode | Modal contents (verified) | Title limit |
| --- | --- | --- |
| 视频 | tabs `素材库` / `视频号动态` / `视频链接` + **`本地上传`** + `确定` / `取消` | **0/20** |
| 播客 | `从素材库选择`, search input `搜索音频`, **`上传音频`**, `插入` / `取消` | **0/20** |

So the workflow per mode is: open the mode → satisfy its media modal (`上传…` or pick from 素材库) → confirm/insert → then title (≤20) + author + body → `保存为草稿` or `发表`. A missing artifact must be rejected by the plugin **before** it opens a browser, because the save control does not exist until the artifact is attached.

**Safety note:** the hit test refused the save twice — once through the media modal, once with the cover panel open (`REFUSED: found but not on top`). No covered control was ever clicked.

## 5.3 一键排版 (one-click layout) — present in MP 文章, and how it resolves

The operator asked whether `一键排版` applies to MP 文章. It **does**:

| Fact | Evidence |
| --- | --- |
| Control | `div.ailayout-btn_wrp` → `div.ailayout-btn_label`, text **一键排版**, at (1948,1350,106x36) — an `ailayout-*` (AI layout) widget in the editor chrome |
| Click result | hit-test verified click at (2001,1368) → toasts `一键排版` ×2 and a **format-choice set: `保留源格式` / `匹配目标格式` / `仅保留文本`** |
| Effect on content | body text length unchanged (8 → 8): it applies **layout/formatting**, it does not rewrite the text |

**Flow implication for the plugin:** insert the Content body, then click `一键排版` and choose **`匹配目标格式`**
(match the target format) so the platform's own layout rules apply to markdown-derived content.
`保留源格式` keeps the pasted styling and `仅保留文本` strips it — both are wrong for our case.
The same control also exists on xhs 写长文 (see `xhs-ui-discovery.md` §2), so this is a cross-channel
step, not an MP-only one.

### Account-level preconditions found while probing (block 发表, not the draft)

* `未设置头像和名称 发表内容需要完善公众号头像和名称` — the 公众号 needs an avatar and a name set.
* `公众号尚未实名 前往实名` — the account is not yet verified.
* `未授权使用切换账号能力…` — account switching needs a login that grants it.

These are **account configuration** items for the operator, not plugin defects; the plugin should
surface them as an actionable result rather than a generic failure (the platform's own dialog text is
the message to relay).

## 6. First-pass open items — dispositions

The first pass left five open items; the second and third passes (header notes above) closed them:

- 封面: no file input; the 文章 draft saves without a cover (platform marks it 请补充封面图 at 发表,
  not at draft) — recorded in §5.2. Cover is a 发表 precondition, outside the draft path.
- 视频 / 播客: **excluded from unattended capture** — the media modal covers the save bar
  (artifact-gated, §5.2); `本地上传` stays attended-only (third pass, item 4).
- 贴图: resolved — `保存为草稿` opens a validating save-settings dialog; no `appmsgid` by platform
  design (third pass, items 1–3).
- Per-mode field matrix: recorded in §5.1 and §5.2 and consumed by task 0205.

## 7. Safety

- MP shows no automation guard in this repo's plugin code, but the walk is still held to the same
  discipline: **one attended pass, draft-only, no publish activation**, abort on any platform warning
  (none appeared). The 文章 attempt left **one** draft, which the platform itself marks as
  unpublishable, and it is named `kk discovery draft for 文章 — safe to delete.`
- The session now persists in the real profile dir, so the plugin can use it directly. Profile
  locking matters: one Chromium per profile dir, and a stale `SingletonLock` may only be cleared
  after confirming no Chromium holds the profile.
