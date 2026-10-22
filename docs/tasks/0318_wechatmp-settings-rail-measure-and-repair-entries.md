---
schema_version: 1
name: "wechatmp 文章 settings rail: measure and repair 原创/创作来源/原文链接 entries"
status: todo
template: issue
created_at: 2026-10-22T03:08:10.155Z
updated_at: "2026-10-22T03:08:19.538Z"

---

## 0318. wechatmp 文章 settings rail: measure and repair 原创/创作来源/原文链接 entries

### Background

The 2026-10-21 daily draft (`appmsgid=100001043`) shipped with three settings rows unset, and the same
was true on 10-19/10-20: `原创声明未生效`, `创作来源未生效`, `原文链接: no URL field in the 原文链接
dialog`. Because 原创 is unchecked the platform also disables 赞赏 and 付费 ("声明原创后才可开启"), so the
draft loses its reward block on top of the three rows.

The committed-state probes are fine: `#js_original`, `.js_ori_setting_checkbox`,
`#js_reward_setting_area`, `#js_claim_source_area`, `.js_claim_source_selected`, `#author`,
`textarea#title` all still exist in the live editor (measured 2026-10-21, evidence
`.spur/memory/evidence/20261021-wechatmp/wechatmp-probe{,2,3,4}-20261021.json`). What changed is the
ENTRY path into each dialog and the dialog's own control set:

- 原创: entry is `#js_original i.read-more__icon__more-inactive`; the dialog now carries
  `声明类型 (文字原创 | 无需声明)`, `作者 0/8`, `白名单`, `快捷转载`, and a required
  `我已阅读并同意《微信公众平台原创声明及相关功能使用协议》` checkbox whose real `input[type=checkbox]`
  is HIDDEN behind a styled label; commit with `确定`.
- 创作来源: entry is `#js_claim_source_area .allow_click_opr`; the dialog's 声明类型 radios are
  `内容由AI生成` / `素材来源官方媒体/网络新闻` / `内容剧情演绎，仅供娱乐` / `个人观点，仅供参考` (the
  daily stage's stance) / `健康医疗分享，仅供参考` / `投资观点，仅供参考` / `无需声明`, committed with
  **`确认`** (the 原创 dialog uses `确定` — the two differ).
- 原文链接: `#js_article_url_area input.frm_checkbox.js_url_checkbox` is visible in the DOM but
  Playwright `check()` times out on it, and clicking `.allow_click_opr` ("未添加") in an empty editor
  does nothing — the field's real entry is still unmeasured.

The audio-material and cover-input selectors were already repaired on 2026-10-21
(`flow.ts` `AUDIO_UPLOAD_INPUT` / `AUDIO_COVER_INPUT`: the form's inputs carry `accept=''` and
`image/bmp, image/png, …` respectively); this task covers the settings rail only.

### Requirements

- [ ] R1. 原创 commits: open the row from its visible entry, satisfy the agreement control even though its
  input is hidden, fill 作者 when the platform leaves it empty, click `确定`, and verify
  `.js_ori_setting_checkbox.checked === true` AFTER the dialog closes. A row whose switch is still
  unchecked is the named warning this task exists to remove.
- [ ] R2. 创作来源 commits: select the requested stance from the 声明类型 radios and click that dialog's
  own confirm label (`确认`), then verify `.js_claim_source_selected` carries the requested text.
  A stance that the platform does not offer is a named skip, never a silent one.
- [ ] R3. 原文链接 commits: measure the row's real entry (row label click vs `allow_click_opr`), set the
  URL, and verify the readback the row renders (`未添加` → the saved URL). The unmeasured entry is
  named in the evidence doc before code changes.
- [ ] R4. 赞赏 unblocks: with R1 committed, the 赞赏 row is no longer "声明原创后才可开启", so the
  existing 赞赏 step must reach its switch and verify it, or name why the platform kept it disabled.
- [ ] R5. fixture-DOM regression: the new entry and agreement expressions run against synthetic DOM in
  `tests/fixtures/wechatmp-dom-runner.ts` (real Chromium), catching mixed-engine selector unions and
  hidden-input clicks offline.

### Acceptance Criteria

- [ ] AC1 — one attended E2E draft (draft-only, no 发表) shows 原创, 创作来源 and 原文链接 committed and
  re-read from the DOM after the dialogs close; the run's `metadata.enrichWarnings` (or its
  replacement) names no row as `未生效`.
- [ ] AC2 — the fixture regression fails on the pre-fix entry selectors and passes after, executed by
  `bun test plugins/publishings/wechatmp-pub/tests/`.
- [ ] AC3 — `docs/design/wechatmp-ui-discovery.md` carries the measured shapes this task relied on and the
  per-row control/confirm labels as of the measurement date.

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
