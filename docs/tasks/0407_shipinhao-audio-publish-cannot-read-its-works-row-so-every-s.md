---
schema_version: 1
name: shipinhao audio publish cannot read its works row, so every submission is unknown
status: todo
template: issue
created_at: 2026-11-18T23:29:36.971Z
updated_at: "2026-11-20T00:28:50.242Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P3
estimate_hours: 0.5
feature_id: L3
---

## 0407. shipinhao audio publish cannot read its works row, so every submission is unknown

### Background

Captured from the creation title: "shipinhao audio publish cannot read its works row so every scheduled audio row is uncertain".

**Refine corrections (2026-11-19)**

- **Already fixed; ready to close, not to implement.** The hypothesis in the title ("cannot read its works row") was wrong. The leaf cause was an uncommitted 封面 that made the platform refuse the submit (see Root Cause). The fix landed in commit 130c9c22 (2026-11-18, `plugins/publishings/shipinhao-pub/src/audio-flow.ts`, `CROP_IMAGE` 274, cropper wait 214, `audio-submit-validation` 456) with two regression tests. Re-run 2026-11-19: `bun test plugins/publishings/shipinhao-pub/tests/audio-flow.test.ts` → 37 pass, 0 fail. Live: `shipinhao-pub.audio` `succeeded/confirmed` for 11-17 and 11-18 (Root Cause) and 11-19 (`.spur/context/memory.md:316`).
- **Valid on the new workflow.** The row `shipinhao-pub / audio / episode` is live in `plugins/kk/publish-presets/daily-ai-voice.json:39-49`.
- **Secondary finding dropped from this task.** Auto-reclaiming a dead-pid browser lease would contradict the frozen lease contract in `packages/publish-harness/src/profile-lease.ts:8-13` (task 0276: "A lease is never killed or auto-removed"; refusal text 248). `reclaimStaleNativeLock` (293-330) covers only Chromium's native `SingletonLock`. Changing that policy needs its own ADR entry and task, so it is raised to the operator as a candidate, not done here.
- **Remaining action:** verify + close (`/sp:dev-verify 0407`, then wrap). Estimate lowered to 0.5 h.

### Requirements

- [ ] R1. — Commit the 封面 before submitting. Success is the crop dialog closing, not the upload percentage or the click returning.
- [ ] R2. — Name a refused submit. A submit refused client-side reports the form's inline validation line (stage `audio-submit-validation`), never a blind receipt wait. "Clicked but unconfirmed" stays `unknown`, never published.

**Non-goals:** the dead-pid browser-lease reclaim (contradicts the frozen 0276 contract; separate ADR + task if wanted).

*Original report (superseded by Root Cause):* `kk news publish --window after-generate` marked `shipinhao-pub.audio` uncertain: 发表音频 was clicked but no row carrying the title appeared in 音频管理 (stage `audio-receipt`).

### Acceptance Criteria

```gherkin
Scenario: AC1 — The cover is committed before submit (req: R1)
  Given the 音频 form whose crop dialog mounts before its cropper image
  When attachAudioCover runs
  Then it waits for the upload to settle and the cropper image, clicks 确认 inside the crop dialog, and succeeds only when the dialog closes

Scenario: AC2 — A refused submit names the inline validation (req: R2)
  Given a submit that leaves the page on /platform/post/createAudio with 请上传封面
  When the flow reads the outcome
  Then it fails at stage audio-submit-validation naming that line, instead of a 30 s unknown receipt wait

Scenario: AC3 — Live rows confirm (req: R1, R2)
  Given the scheduled after-generate window on 2026-11-17, 11-18 and 11-19
  When the shipinhao-pub.audio receipt is read
  Then it is succeeded with a confirmed works row
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

As shipped in 130c9c22: `attachAudioCover` waits for upload settle → crop dialog + `CROP_IMAGE` → dialog-scoped 确认 → dialog closed. After submit, if still on `/platform/post/createAudio`, it reads the inline validation (`请上传封面` / `请上传音频` / `请填写标题` / `请填写描述` / `请选择合集`) and fails with stage `audio-submit-validation`. File: `plugins/publishings/shipinhao-pub/src/audio-flow.ts`.

### Plan

1. ~~Fix and regression tests~~ (done, 130c9c22).
2. `/sp:dev-verify 0407`: the AC1/AC2 tests in `plugins/publishings/shipinhao-pub/tests/audio-flow.test.ts`, AC3 receipts.
3. `/sp:dev-wrap 0407`.
4. Operator: delete the duplicate 2026-11-18 16:25 row in 音频管理 (Root Cause note).

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

- `plugins/publishings/shipinhao-pub/src/audio-flow.ts`: cover commit wait (`CROP_IMAGE` 274, cropper wait ~214); post-submit inline validation read, stage `audio-submit-validation` (~456). Commit 130c9c22.
- `plugins/publishings/shipinhao-pub/tests/audio-flow.test.ts`: +2 regression tests (upload never settles; submit refused by inline validation).

### Testing

- 2026-11-19: `bun test plugins/publishings/shipinhao-pub/tests/audio-flow.test.ts` → 37 pass, 0 fail (single-file runs exit 1 on coverage by design, see AGENTS.md § Testing).
- Live receipts: `succeeded/confirmed` for 2026-11-17 and 2026-11-18 (Root Cause), and 2026-11-19 (`.spur/context/memory.md:316`).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
