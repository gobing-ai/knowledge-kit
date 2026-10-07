---
schema_version: 1
name: Fix the recorded per-channel UI drift and add validated mode dispatch
status: done
template: feature-impl
created_at: 2026-10-05T18:00:10.115Z
updated_at: "2026-10-07T22:37:39.929Z"
feature_id: E92

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0205-verdict.json
---

## 0205. Fix the recorded per-channel UI drift and add validated mode dispatch

### Background

The per-channel drift lists recorded by the discovery tasks (0199–0204) are the input: entry URLs, selectors, step order and success signals that the `wt`-migrated plugins get wrong against the live consoles. This task fixes them per channel and adds the validated mode dispatch the architecture decision requires — one plugin per channel, modes as first-class `operation`s, shared login/session per channel.

### Requirements

- [x] R1. Every drift item recorded by 0199–0204 is either corrected in its channel plugin or listed as an explicit exclusion with its reason.
- [x] R2. Each channel validates its requested `operation` against a declared mode list and fails with a named unsupported-operation error before any browser opens or profile is resolved.
- [x] R3. Each corrected channel saves a draft through the real console with an observed signal, and a channel whose signal never appears returns `ok:false` naming it.
- [x] R5. Recorded gaps are fixed or explicitly excluded with a reason.

### Acceptance Criteria

- [x] AC1 — R2 — A channel exposes its modes as validated operations and refuses an unknown one before opening a browser (req: R2)
- [x] AC2 — R3 — Each corrected flow saves a draft through the real console with an observed signal (req: R3)
- [x] AC3 — R5 — Recorded gaps are fixed or explicitly excluded with a reason (req: R1)

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

- [x] 0. Consume the discovery evidence for each channel; write the corrected mode table and drift dispositions. — all six discovery docs consumed; corrected tables + dispositions in the channel modules and doc updates (commit 635234ba).
- [x] 1. Add the declared mode list + validated dispatch per channel, with the pre-browser fast-fail. — union refusals gate-fixed; named unsupported-operation errors before profile resolution; offline tests (1949 green).
- [x] 2. Split the per-mode flows into modules where a channel has more than one mode. — wechatmp per-mode modules (文章/贴图/视频/播客).
- [x] 3. Apply the selector/URL/signal corrections, with an offline test per corrected path. — x edit-URL regex, substack publication-host entry + exact-placeholder title, wechatmp type=77&createType=N + textarea title, infoq/juejin hydration waits; offline tests per path.
- [x] 4. Re-run each channel's draft path against the recorded evidence (operator-attended where the platform is capped). — real-console draft saves measured per channel 2026-10-06 evening: infoq 已保存 + /draft/405943 + reload; juejin 保存成功 + 7693358476032786442 + reload; x Last saved + 2107589269258919936 + Drafts row; substack Saved + 219172498 + reload; wechatmp 文章 appmsgid 100000899. Walk JSONs in .spur/run/discovery/.
- [x] 5. Record the exclusions with reasons and report the per-channel disposition. — 贴图 dialog-validation signal (no appmsgid by design), 视频/播客 artifact-gated save bar, 信息条 headless-451 — recorded in discovery docs with reasons.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `docs/features/E92_publish-channel-ui-fidelity-per-mode-discovery-and-gap-fixes.md:105` |
| `docs/features/E92_publish-channel-ui-fidelity-per-mode-discovery-and-gap-fixes.md:5` |
| `docs/features/E92_publish-channel-ui-fidelity-per-mode-discovery-and-gap-fixes.md:9` |
| `docs/features/E92_publish-channel-ui-fidelity-per-mode-discovery-and-gap-fixes.md:90` |
| `docs/features/INDEX.md:43` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:10` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:103` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:109` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:117` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:120` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:132` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:24` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:30` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:4` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:47` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:62` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:7` |
| `docs/tasks/0201_discover-the-infoq-write-console-and-record-ui-draft-drift.md:98` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:10` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:105` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:110` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:116` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:124` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:127` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:139` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:24` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:30` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:4` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:47` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:62` |
| `docs/tasks/0202_discover-the-juejin-editor-and-record-ui-draft-drift.md:7` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:10` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:112` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:117` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:123` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:131` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:134` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:146` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:24` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:30` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:4` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:47` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:60` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:62` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:69` |
| `docs/tasks/0203_discover-the-substack-editor-and-record-ui-draft-drift.md:7` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:10` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:104` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:109` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:121` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:126` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:132` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:140` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:143` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:155` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:24` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:30` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:4` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:47` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:61` |
| `docs/tasks/0204_discover-the-x-compose-console-article-and-post-and-record-u.md:7` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Corrections in channel code at commit 635234ba plus discovery-doc dispositions: xhs drift 1-7 dispositioned at `docs/design/xhs-ui-discovery.md:42-70`; wechatmp drift list `docs/design/wechatmp-ui-discovery.md:54-68` with dispositions `docs/design/wechatmp-ui-discovery.md:188-200`; x post-mode exclusion `docs/design/x-article-ui-discovery.md:5-8`; infoq/juejin/substack recorded-candidate → verdict tables (`docs/design/juejin-ui-discovery.md:18-28`, `docs/design/substack-ui-discovery.md:22-34`) |
| R2 | MET | Declared mode lists with named refusal before profile/browser: `plugins/publishings/infoq-pub/src/index.ts:193-232`, `plugins/publishings/juejin-pub/src/index.ts:156-195`, `plugins/publishings/substack-pub/src/index.ts:147-181`, `plugins/publishings/x-pub/src/index.ts:90-99`, `plugins/publishings/wechatmp-pub/src/modes.ts:27-88`, `plugins/publishings/xhs-pub/src/index.ts:230-233`; refusal tests e.g. `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:534`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1890`; bun test over the six channel suites re-run 2026-10-07: 303 pass / 0 fail |
| R3 | MET | Real-console draft saves with observed signals in .spur/run/discovery/ (infoq-walk3, juejin-walk2, x-walk3, substack-walk4, wechatmp-attended, xhs-draft-signal-cdp JSON, all re-listed this run); xhs signal wired at `plugins/publishings/xhs-pub/src/flow.ts:72`; ok:false on an unobserved signal tested per channel at `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:735`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1137`, `plugins/publishings/x-pub/tests/x-pub.test.ts:375`, `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:310`, `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:321`, `plugins/publishings/substack-pub/tests/substack-pub.test.ts:364` |
| R5 | MET | Gaps fixed or excluded with reason: 贴图 dialog-validation signal and 视频/播客 artifact gating (`docs/design/wechatmp-ui-discovery.md:188-200`), xhs 视频/发播客 artifact gating (`docs/design/xhs-ui-discovery.md:67-70`), x post mode (`docs/design/x-article-ui-discovery.md:5-8`) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R2 — A channel exposes its modes as validated operations and refuses an unknown one before opening a browser | MET | test | bun test over the six channel suites re-run 2026-10-07: 303 pass / 0 fail; refusal asserted at `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:434` and `plugins/publishings/x-pub/tests/x-pub.test.ts:706` |
| R3 — Each corrected flow saves a draft through the real console with an observed signal | MET | test | `ls .spur/run/discovery/infoq-walk3.json .spur/run/discovery/juejin-walk2.json .spur/run/discovery/x-walk3.json .spur/run/discovery/substack-walk4.json .spur/run/discovery/wechatmp-attended.json .spur/run/discovery/xhs-draft-signal-cdp.json` → all six present (re-run 2026-10-07); ok:false on an unobserved signal tested per channel at `plugins/publishings/wechatmp-pub/tests/wechatmp-pub.test.ts:735`, `plugins/publishings/xhs-pub/tests/xhs-pub.test.ts:1137`, `plugins/publishings/x-pub/tests/x-pub.test.ts:375`, `plugins/publishings/infoq-pub/tests/infoq-pub.test.ts:310`, `plugins/publishings/juejin-pub/tests/juejin-pub.test.ts:321`, `plugins/publishings/substack-pub/tests/substack-pub.test.ts:364` |
| R5 — Recorded gaps are fixed or explicitly excluded with a reason | MET | command | `rg -n "excluded" docs/design` re-run 2026-10-07 → exclusions with reasons in the xhs, wechatmp and x-article discovery docs |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-06T18:23:10.677Z backlog → wip (system)
- 2026-10-06T18:26:26.623Z wip → testing (system)
- 2026-10-06T22:24:03.003Z testing → done (system)
- 2026-10-06T22:30:03.478Z done → testing (system)
- 2026-10-06T22:30:04.316Z testing → done (system)
- 2026-10-06T22:38:04.339Z done → testing (system)
- 2026-10-06T22:38:05.042Z testing → done (system)

