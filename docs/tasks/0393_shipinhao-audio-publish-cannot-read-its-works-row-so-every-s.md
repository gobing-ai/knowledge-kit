---
schema_version: 1
name: shipinhao audio publish cannot read its works row, so every submission is unknown
status: todo
template: issue
created_at: 2026-11-18T23:29:36.971Z
updated_at: "2026-11-18T23:29:37.113Z"

---

## 0393. shipinhao audio publish cannot read its works row, so every submission is unknown

### Background

Captured from the creation title: "shipinhao audio publish cannot read its works row, so every submission is unknown".

### Requirements

kk news publish --window after-generate marks shipinhao-pub.audio uncertain: 发表音频 was clicked but no row carrying the title was ever observed in 音频管理 (plugins/publishings/shipinhao-pub/src/audio-flow.ts:380, stage 'audio-receipt').

Evidence (2026-11-18):
- receipt .works/kk-news-generate/20261118/4-publish/receipts/shipinhao-pub.audio.json: status uncertain / effect unknown, durationMs 83777, metadata.stage 'audio-receipt', evidence '音频 list row never observed'.
- Before the 2026-11-18 login the row failed at the session preflight ('Authentication was not confirmed within 180000ms'); after 'bun plugins/publishings/shipinhao-pub/src/profile-check.ts login' verified the profile, the run reached the submit and failed only at the receipt read.
- Independent recon with the harness launcher (packages/publish-harness/src/browser.ts createKkBrowserLauncher, headless:false) reached https://channels.weixin.qq.com/platform/post/audioManager but the grid never rendered rows after 20+s of polling, i.e. the blind spot is in reading the list, not necessarily in publishing.
- The code's own recon note (audio-flow.ts:272) records that a missing 封面 makes the platform refuse with 「请上传封面」 and produce no works row; the receipt carries no cover warning, so both causes are open.

What is needed: decide from the live console which failure this is (row exists under a different render vs cover refusal), then make the receipt read robust (wait for the grid's data request, or read the works list through the authenticated CGI) and keep 'clicked but unconfirmed' as unknown — never as published.
Immediate operator check: does 视频号 → 内容管理 → 音频 list a '每日AI乱炖 · 2026-11-18' row?

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
