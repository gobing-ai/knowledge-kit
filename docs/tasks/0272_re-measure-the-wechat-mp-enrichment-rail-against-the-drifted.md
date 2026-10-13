---
schema_version: 1
name: Re-measure the WeChat MP enrichment rail against the drifted console
status: todo
template: issue
created_at: 2026-10-13T03:22:54.165Z
updated_at: "2026-10-13T15:25:37.170Z"
feature_id: G11

ac_altitude: task-local
---

## 0272. Re-measure the WeChat MP enrichment rail against the drifted console

### Background

Every daily MP draft since at least 2026-10-11 lands with the title, body and 合集 only. The enrichment rail (`plugins/publishings/wechatmp-pub/src/enrich.ts`, plus the cover and audio steps in `flow.ts`) reports the same 7 warnings on every run:

```
原创声明: dialog did not close — check the draft
赞赏: click: Timeout 8000ms exceeded ... waiting for '.weui-desktop-dialog:visible button:has-text("确认"'
原文链接: no URL field in the 原文链接 dialog
创作来源: 未生效，请手动设置
音频: click: Timeout 8000ms exceeded ... waiting for 'text=上传音频, button:has-text("上传音频")'
一键排版: clicked, but no 匹配目标格式 option appeared
cover: 从图片库选择 was not offered by the open cover panel
```

The 2026-10-10 operator walk that was supposed to automate this does not reproduce mechanically. Measured live on 2026-10-12 (headless, the now-valid session, draft `appmsgid=100000963`), the console serves a different shape than the rail expects:

- **Row entry points.** The rail's first-choice selectors are stale: `.setting-group__switch.js_can_reward` and `.allow_click_opr.js_url_checkbox` match **0** elements. Present instead: the 原创 row is `.setting-group__switch.js_original_apply.js_edit_ori` (text `未声明`), and there are **two** 赞赏 rows — `js_reward_open` and `js_reward_allow_click` (both carry a checkbox) — plus `js_gongyi_open`, `js_pay_open-tips`, `js_interaction`, `js_danmu_allow_click`.
- **The chain is gated by 原创.** The 赞赏 row reads `声明原创后才可开启`, so a failed 原创 declaration starves 赞赏/付费 and every step ordered after it. The 原创 dialog exists and its confirm is `button.weui-desktop-btn.weui-desktop-btn_primary` with text **确定**; the rail's `:text("文字原创")` declaration control did not resolve, so it clicked 确定 alone and the dialog stayed open (platform validation) — the rail's own `dialogsClosed()` check caught it.
- **赞赏 has an account prerequisite.** After a valid session the row reads `无法开启赞赏，因为还没有赞赏账户`: no 赞赏账户 exists on this account, so 赞赏 is not achievable by any selector. This is operator-owned.
- **原文链接 is gone as a settings row.** The 17 rows now served are 封面和摘要, 封面, 视频号, 位置, 在认领的位置页展示, 原创, 赞赏, 付费, 赞赏, 公益捐赠, 付费, 原创, 赞赏, 留言, 弹幕, 链接, 文章设置. `链接` (`btm-card-link__switch`, `支持添加内容链接、小程序、小店商品`) is a different feature. The rail's `原文链接` step needs a new decision: find the replacement path or drop the field from `metadata.wechatmp`.
- **一键排版 / 匹配目标格式 is absent** from this build: 0 matches for either label, so the layout step cannot do anything but warn.
- **Audio moved.** The editor's toolbar item is `.tpl_dropdown_menu_item.js_insertaudio` (音频) and the empty-slot control is `.audio_cover_empty.js_replace_media` (`添加音频`); the rail waits for `text=上传音频`.
- **Cover moved.** The open cover panel offers 修改 (`.js_cover_preview_new`), 换一张 (`.js_chooseCoverWrap`) and 从正文选择 (`.js_cover_opr`), while `从图片库选择` now lives in a media dropdown (`.js_img_dropdown_menu` → `.tpl_dropdown_menu_item.js_img_from_local`). `a.js_imagedialog` still exists in the DOM (3 hits) but is not offered by the open panel, which is what the readiness check times out on. The library path also depends on the audio step: the episode cover is uploaded there as the audio material's cover, so a failed audio insert leaves the library without the intended image.

The draft still saves (`ok: true`, `publishStatus: draft`) and every failure is a loud warning, so nothing false-successes — the cost is that the operator completes 5-7 fields by hand in the draft box every day.

Measured follow-up (2026-10-12, live).** The 原创 dialog's real contract, read from the live DOM:

- `声明类型` offers `文字原创` / `漫画原创 字数<300字，且图片≥4张` / `无需声明`, plus `赞赏`, `作者`, `赞赏账户`, `类别`, `白名单` (快捷转载) and the agreement checkbox `我已阅读并同意《微信公众平台原创声明及相关功能使用协议》`.
- The rail ticks nothing: `:text("文字原创")` resolves (it selects the radio — verified `weui-desktop-form__radio js_original` checked) but the protocol agreement stays unchecked, so 确定 leaves the dialog open and `dialogsClosed()` reports `原创声明: dialog did not close`. **Selecting the agreement by its label is what lets 确定 close the dialog** (verified: `dialogs open: 0`).
- The declaration still does **not** persist. After 文字原创 + agreement + 确定 + `保存为草稿` + reload, the row still reads `未声明`. The account's own state explains why: the 赞赏 rows read `无法开启赞赏，因为还没有赞赏账户授权给本…`, and the rail's pre-2026-10-10 warning recorded the rule verbatim — `原创声明: 未生效 - 作者须为赞赏账户(搜索选择)，请手动设置`. The dialog's `作者` field is a search-select over that account's 赞赏账户 list.
- Therefore 原创, and everything the panel gates behind it (`赞赏` reads `声明原创后才可开启`), is blocked on an **account prerequisite**: authorise/create the 赞赏账户. No selector change can complete it, and the rail should report it as an operator action rather than as a click timeout (R3).

What remains purely mechanical and is not gated by 原创: the 封面 panel and the 音频 insert — the cover's `从图片库选择` path needs the audio step to have uploaded the episode cover as that material's cover, so the two are ordered together.

Measured follow-up (2026-10-12, live): the console states the 赞赏 prerequisite and its own remedy, so R3 has an exact operator action to report instead of a click timeout —

```
无法开启赞赏，因为还没有赞赏账户授权给本公众号。如果要取得授权，请到赞赏账户小程序-赞赏账户设置-可收款公众号中添加本公众号。如果要创建赞赏账户，你可以发送赞赏账户邀请。
```

Same read: the article's 原创 row reported `原创 文字原创 · 作者: 冰原奔狼 · 已开启快捷转载` with `编辑声明 / 编辑白名单 / 撤销声明` operations while its switch still read `未声明`, so a declaration pass leaves the author and 快捷转载 applied without the declaration itself registering — the read-back must assert the switch state, not the row's summary text. With no 赞赏账户 there is nothing for the dialog's `作者` search-select to resolve, which is why the declaration cannot complete.

Second live pass (2026-10-13 morning, after the first fully-green daily run):

- **The audio dialog is measured now.** The toolbar's `音频` entry is a DROPDOWN: `.jsInsertIcon.audio` opens it and only then does the item `.tpl_dropdown_menu_item.js_insertaudio` reach the real dialog. That dialog is `插入音频` with tabs `从素材库选择` / `从视频号选择`, a `搜索音频` field, and buttons **`上传音频`**, 下一页, **`插入`**, 取消. The material library already lists past episodes (`每日AI乱炖 · 2026-10-12 16分钟`, 10-11, 10-10, 10-08, 10-07, 10-06, 10-04 …), so the dedupe path can insert without uploading. The rail JS-clicks `li.js_insertaudio` directly and then waits for `.audio_dialog`; the observed failure is the *click* on `上传音频` (found but not clickable within 8 s), which is why the step times out while the control demonstrably exists.
- **The account prerequisite is still open.** The 2026-10-13 draft reads 原创 `未声明` and 赞赏 `不开启 无法开启赞赏，因为还没有赞赏账户授权给本公众号 …`, so 原创 cannot register yet and 赞赏 stays gated. Today's run stopped warning about 原创 (the dialog closed) but the declaration still did not stick — the read-back must assert the switch, as recorded above.
- **A forced re-run of `daily-publish-wechat` hangs, and the hang is not the session.** Removing the cached result and re-running the stage twice (15 min, then 4.5 min) produced no result file and no output; `kk plugin check wechatmp-pub` verifies the session headlessly in 15 s, no lock file exists and no browser is left on the profile after the kill. The same stage completed in ~1.5 min inside this morning's workflow run, so the difference is worth finding before the rail is judged: it needs its own session with the account authorised.
- The forced re-run **deleted** `31-publish/20261013_20_publish-wechat_result.json` (the documented "redo by delete") and could not regenerate it. The run's own record is intact — `31-publish/20261013_17_publish_completeness.json` still reads `wechat done draft`, the ledger row and the run report are written, and the draft itself exists (`appmsgid=100000971`) — but a future re-run of `daily-publish-completeness` would now see the channel as missing until the stage succeeds again.

### Requirements

- [ ] R1. Re-measure each enrichment step against the live console and update its selectors, keeping the rail's commit-verified shape (open row → act in dialog → confirm → re-read the DOM; a step that does not stick stays a loud warning).
- [ ] R2. Treat the 原创 declaration as the gate it is: make it either succeed (declaration control + confirm + closed-dialog verification) or fail the whole dependent group early, so 赞赏/付费 are not attempted against a state that cannot accept them.
- [ ] R3. Make the account prerequisites explicit and separate from selector failures: when the console states `无法开启赞赏，因为还没有赞赏账户`, report that as an operator action (create the 赞赏账户) rather than as a step failure the next run will retry.
- [ ] R4. Decide the fate of the 原文链接 step for a build that has no such row — find the replacement path or remove `originalUrl` from the stage's `metadata.wechatmp` — and record the decision, because the field is currently produced by the daily stage and silently dropped.
- [ ] R5. Make the layout step (一键排版 / 匹配目标格式) detect its own absence and skip without a warning, or remove the step if the build no longer offers it; a permanent warning on every run trains the operator to ignore warnings.
- [ ] R6. Fix the cover path against the measured panel (换一张 → 图片库 dropdown → 从图片库选择, or 从正文选择) and keep the audio dependency explicit: the library entry the cover wants is the audio material's cover, so the cover step must not silently degrade when the audio step failed.
- [ ] R7. Fix the audio insert against the measured entry points (`js_insertaudio` / `添加音频`), including the upload sub-flow (file → cover → title → platform-rules acknowledgement → 保存 → 插入).
- [ ] R8. Keep the whole rail non-blocking: the draft still saves, and a failed enrichment never fails the run (`onError: continue` stays).
- [ ] R9. Prove the fix end to end on a real draft: a fresh daily run whose `enrichWarnings` is empty for the fields the account supports, recorded with the draft id and a read-back of each field.

### Acceptance Criteria

- [ ] AC1 — A fresh draft run reports no `enrichWarnings` for 原创, cover, 创作来源, audio and 排版 (or, for 排版, no warning because the step knows the control is absent). (req: R1, R5, R6, R7, R9)
- [ ] AC2 — With no 赞赏账户 on the account, the 赞赏 outcome names the operator action instead of a click timeout, and the run does not retry it. (req: R3)
- [ ] AC3 — A failed 原创 declaration does not produce a downstream cascade of indistinguishable click timeouts. (req: R2)
- [ ] AC4 — `metadata.wechatmp.originalUrl` is either carried into the draft or no longer produced, with the decision recorded. (req: R4)
- [ ] AC5 — The draft still saves and the run still exits 0 when every enrichment step fails. (req: R8)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
