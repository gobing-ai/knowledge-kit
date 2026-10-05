---
schema_version: 1
name: Fix the recorded per-channel UI drift and add validated mode dispatch
status: backlog
template: feature-impl
created_at: 2026-10-05T18:00:10.115Z
updated_at: "2026-10-05T22:28:20.424Z"
feature_id: Q

---

## 0205. Fix the recorded per-channel UI drift and add validated mode dispatch

### Background

The per-channel drift lists recorded by the discovery tasks (0199–0204) are the input: entry URLs, selectors, step order and success signals that the `wt`-migrated plugins get wrong against the live consoles. This task fixes them per channel and adds the validated mode dispatch the architecture decision requires — one plugin per channel, modes as first-class `operation`s, shared login/session per channel.

### Requirements

- [ ] R1. Every drift item recorded by 0199–0204 is either corrected in its channel plugin or listed as an explicit exclusion with its reason.
- [ ] R2. Each channel validates its requested `operation` against a declared mode list and fails with a named unsupported-operation error before any browser opens or profile is resolved.
- [ ] R3. Each corrected channel saves a draft through the real console with an observed signal, and a channel whose signal never appears returns `ok:false` naming it.

### Acceptance Criteria

- [ ] AC1 — R2 — A channel exposes its modes as validated operations and refuses an unknown one before opening a browser (req: R2)
- [ ] AC2 — R3 — Each corrected flow saves a draft through the real console with an observed signal (req: R3)
- [ ] AC3 — R5 — Recorded gaps are fixed or explicitly excluded with a reason (req: R1)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-05T18:38:52.643Z

#### Q&A entry — 2026-10-05T18:35Z

- **Q: xhs 写长文 — author in place or use `导入链接`?** Closed: **author in place from the raw markdown.** `导入链接` is fed from a 公众号/wechatmp source, so it would require publishing to another platform (and passing its censorship) before xhs could import anything — an extra external dependency on the critical path. The plugin fills the ProseMirror body directly from the Content body; the editor's `一键排版` control is what formats pasted markdown.
- **Q: xhs 发播客 — audio upload or `添加RSS订阅`?** Closed: **audio upload only.** The RSS path subscribes to an existing feed rather than publishing our Content; recorded as an exclusion (§5 D11 of `docs/design/xhs-ui-discovery.md`).
- **Q: which save control does xhs use?** Closed: **`暂存离开`** (`BUTTON.ce-btn.white`), not a 存草稿-style control, and in 图文 it is reachable only through the CDP pierced DOM (closed shadow root).
- **Q: what is the xhs draft signal?** Closed: the **`保存成功` toast plus the sidebar `草稿箱(N)` counter** — the URL does not change, so a URL-diff probe reports a false failure.

#### Q&A entry — 2026-10-05T21:26:37.575Z

#### Q&A entry — 2026-10-05T21:26Z (wechatmp mechanics)

- **Q: how is the MP article title authored?** Closed: **type into the title ProseMirror block** (`div.ProseMirror[data-placeholder="请在这里输入标题"]`). `textarea#title` is a **hidden form mirror** — filling it alone saves a draft with an *empty* title (measured: draft row reported 内容不完整 until the block was typed into; the mirror then read back the text).
- **Q: how is the MP cover set?** Closed: **there is no cover file input.** The panel offers `修改` / `换一张` / **从正文选择** (`a.js_selectCoverFromContent`) / `从图片库选择` / `微信扫码上传` / `AI 配图`, and states **默认首图为封面**. The plugin path is therefore "an image in the body + 从正文选择", not an upload. The panel's image list is not `<img>`-based (probe: `panels: 5, imgs: 0`), so that widget needs its own iteration.
- **Q: do MP 视频/播客 have a draft concept?** Closed: **yes — the same bar** (`保存为草稿` · `预览` · `发表`), but each mode opens a **modal media dialog that covers the bar** (视频: 素材库/视频号动态/视频链接 + 本地上传 + 确定; 播客: 从素材库选择 + 搜索音频 + 上传音频 + 插入). The plugin must attach the artifact first; the save control does not exist until it does.
- **Q: per-mode field limits?** Closed: title **0/64 for 文章, 0/20 for 视频/播客**; author **0/8** and labelled `原创：` (settings take effect only after 原创 verification); digest **0/120**.
- **Q: MP draft signal?** Closed: the **草稿箱 row keyed by title with its `更新于` timestamp**; MP auto-saves continuously (`自动保存` + 历史版本) and `系统繁忙，请稍后再试` is **not** a save-failure indicator.
- **Q: cover/artifact completeness enforcement?** Closed: MP itself refuses publication with **内容不完整，无法发表** and names 封面图/标题/正文 — the plugin may lean on that refusal at the draft/publish boundary but must still fail fast on required fields before opening a browser.

#### Q&A entry — 2026-10-05T21:38:23.635Z

#### Q&A entry — 2026-10-05T21:38Z (layout + account preconditions)

- **Q: should the flow click `一键排版` for MP 文章?** Closed: **yes, and then choose `匹配目标格式`.** The control is `div.ailayout-btn_wrp` / `div.ailayout-btn_label` (text 一键排版) in the editor chrome; a hit-test-verified click surfaces a format-choice set — `保留源格式` / `匹配目标格式` / `仅保留文本` — and applies layout only (body text length was unchanged 8 → 8). `保留源格式` keeps pasted styling and `仅保留文本` strips it; neither is right for markdown-derived Content, so the flow is: insert body → `一键排版` → `匹配目标格式`. The same control exists on xhs 写长文, so this step is cross-channel.
- **Q: what blocks 发表 on the MP account today?** Closed: account configuration, surfaced by the platform's own dialogs — `未设置头像和名称 发表内容需要完善公众号头像和名称`, `公众号尚未实名 前往实名`, and account switching requires a login that grants `允许切换登录我的其他公众号、服务号、小程序`. Draft saving is unaffected; the plugin should relay these as actionable messages rather than a generic failure.

### Design

Approach: mode dispatch inside each channel plugin (the x-pub `post|article` precedent), with a per-channel declared mode list and a named fast-fail; per-mode modules so one mode's selector table and flow stay isolated and testable. Fixes are driven strictly by the discovery evidence — a selector is changed only when the recorded evidence shows the current one is wrong, and each change keeps an offline test (fake launcher/page) plus the shared helpers where they already fit.

Rail: draft-only; the live paths stay operator-explicit; no change to the API/CLI channels' transports.


#### Mode matrices (live evidence, 2026-10-05; ADR-029)

| Channel | Operations | Save control | Success signal | Required artifact |
| ------- | ---------- | ------------ | -------------- | ----------------- |
| xhs | 上传图文 · 上传视频 · 写长文 · 发播客 | `暂存离开` — **closed shadow root**, reachable only via CDP `pierce: true` (light DOM in 写长文) | `保存成功` toast **plus** the `草稿箱(N)` counter; the URL never changes | 图文: ≤18 images; 视频: one video; 播客: audio + cover; 写长文: none |
| wechatmp | 文章 (`createType=0`) · 贴图 (`8`) · 视频 (`5`) · 播客 (`7`) | `保存为草稿` | the `草稿箱` row's `更新于` timestamp (auto-save is continuous) | 文章: cover chosen from a body image; 贴图: ≥1 image; 视频: video; 播客: audio + cover |
| infoq | write → draft | draft control | moved draft URL, or the scoped `保存成功` toast | none |
| juejin | draft | save control | moved draft URL, or the scoped `保存成功` toast | none |
| substack | post draft | draft path | `/publish/post/<id>` URL | none |
| x | article · post (API) | article draft control | `/compose/articles/edit/<id>` URL | article: optional cover |

Cross-mode facts to build on: `一键排版` → `匹配目标格式` exists on both xhs (写长文) and WeChat MP (文章);
MP titles are `0/64` for 文章 but `0/20` for 视频/播客, and MP's author field is `0/8` and gated on 原创;
MP creates the editor in a **new tab** and every console route carries the session `token`;
MP's 视频/播客 media modal **covers the save bar**, so the artifact must exist before the save control does.

### Plan

- [ ] 0. Consume the discovery evidence for each channel; write the corrected mode table and drift dispositions.
- [ ] 1. Add the declared mode list + validated dispatch per channel, with the pre-browser fast-fail.
- [ ] 2. Split the per-mode flows into modules where a channel has more than one mode.
- [ ] 3. Apply the selector/URL/signal corrections, with an offline test per corrected path.
- [ ] 4. Re-run each channel's draft path against the recorded evidence (operator-attended where the platform is capped).
- [ ] 5. Record the exclusions with reasons and report the per-channel disposition.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
