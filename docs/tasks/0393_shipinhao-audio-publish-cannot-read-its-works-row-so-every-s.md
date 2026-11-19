---
schema_version: 1
name: shipinhao audio publish cannot read its works row, so every submission is unknown
status: todo
template: issue
created_at: 2026-11-18T23:29:36.971Z
updated_at: "2026-11-19T00:41:53.911Z"

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

**Leaf cause (dogfooded 2026-11-18).** The 音频 form's 封面 step reported success while the cover was
not committed. Measured sequence: the tile shows an upload percentage (25% observed), the 编辑音频封面
crop dialog renders inside the `WUJIE-APP` shadow root and mounts *before* its cropper image exists, and
the old single `button:text-is("确认")` click fired in that window — the click is swallowed, the dialog
stays open, and the next submit is refused client-side with 「请上传封面」 while the page never leaves
`/platform/post/createAudio`. The receipt stage could only report `unknown`, so every audio publish
since 11-15 ended `uncertain` and nothing was ever published (confirmed in the console by the operator:
no rows for 11-17/11-18 before this fix).

**Fix (`plugins/publishings/shipinhao-pub/src/audio-flow.ts`).**
1. `attachAudioCover` now (a) waits for the upload percentage to disappear, (b) waits for the crop
   dialog AND its cropper image (`CROP_IMAGE`) before clicking, (c) clicks `确认` scoped to
   `CROP_DIALOG`, and (d) treats success as the dialog CLOSING, not the click returning.
2. After the submit, when the page is still on `/platform/post/createAudio`, the flow reads the form's
   inline validation (`请上传封面` / `请上传音频` / `请填写标题` / `请填写描述` / `请选择合集`) and fails
   with stage `audio-submit-validation` naming the line, instead of a 30 s receipt wait that can only
   say "unknown".

**Verification.** Two regression tests added to `plugins/publishings/shipinhao-pub/tests/audio-flow.test.ts`
(upload never settles; submit refused by inline validation). Plugin suite 135 pass. Live dogfood through
`createKkBrowserLauncher` published 每日AI乱炖 · 2026-11-18 (console: 发表成功, row 已发表) and then the
real publish rows confirmed it: `shipinhao-pub.audio` → `succeeded / confirmed` for both 2026-11-17 and
2026-11-18 (`.works/kk-news-generate/<date>/4-publish/receipts/shipinhao-pub.audio.json`).

**Note.** Two 2026-11-18 rows exist: the dogfood publish (发布时间 16:25) and the receipt-producing one
(16:31). Both are the same audio; delete the 16:25 row in the console.

**Secondary finding.** A crashed harness process leaves its browser lease behind and the next launch
refuses it ("browser lease … is held by pid N", `packages/publish-harness/src/profile-lease.ts`), even
though the native Chromium lock self-heals for a dead pid. Recovery is manual (`rm -rf` the lease dir);
auto-reclaim for a dead pid on this host would match `reclaimStaleNativeLock`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
