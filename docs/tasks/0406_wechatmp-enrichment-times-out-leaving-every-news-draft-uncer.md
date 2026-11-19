---
schema_version: 1
name: wechatmp 赞赏 enrichment times out, leaving every news draft uncertain
status: todo
template: issue
created_at: 2026-11-18T23:29:22.307Z
updated_at: "2026-11-18T23:29:22.508Z"

---

## 0406. wechatmp 赞赏 enrichment times out, leaving every news draft uncertain

### Background

Captured from the creation title: "wechatmp 赞赏 enrichment times out, leaving every news draft uncertain".

### Requirements

kk news publish --window after-generate marks wechatmp-pub.文章 uncertain because the 赞赏 enrichment step cannot confirm its dialog.

Evidence (2026-11-18, .works/kk-news-generate/20261118/4-publish/receipts/wechatmp-pub.文章.json):
- error: 'draft saved but enrichment did not apply — 赞赏: click: Timeout 8000ms exceeded' waiting for '.weui-desktop-dialog:visible button:has-text("确认"), .weui-desktop-dialog:visible button:has-text("确定")' (plugins/publishings/wechatmp-pub/src/enrich.ts:34 DIALOG_CONFIRM).
- Same signature on 2026-11-17 (recipe uncertain); 2026-11-16 succeeded.
- The draft itself always saves, so the session and the CGI draft path are fine; only the settings-rail enrichment fails.
- bec762a2 (11-15) started failing the row on unapplied enrichment, which is why this now blocks the window instead of warning.

What is needed: a measured selector pass over the live v2 editor (kk bot record wechatmp, click 赞赏, codegen the rail) to capture what the reward row opens today (dialog vs popover) and its confirm control's label, then update DIALOG_CONFIRM/ROW_REWARD with that evidence — never a guessed selector.
Secondary: re-attempts create a new draft each time (4 x '每日AI乱炖 · 2026-11-18' drafts observed in the console on 11-18); the row should dedupe or reuse an existing draft for the same run.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

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
