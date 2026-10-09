---
schema_version: 1
name: The 发播客 note uploads the episode mp3 and cover as one episode
status: backlog
template: feature-impl
created_at: 2026-10-09T06:24:08.594Z
updated_at: "2026-10-09T06:25:05.856Z"
feature_id: G12

priority: P2
---

## 0236. The 发播客 note uploads the episode mp3 and cover as one episode

### Background

Feature G12 scenario R2. 每日AI乱炖 should also leave a 发播客 note for the same episode: that episode's mp3 and that episode's cover, uploaded as one episode. The creator console does not offer a usable RSS import, so this is not a feed. Important, not urgent.

The 发播客 control is 上传音频. It opens a modal with an audio picker and a cover picker (`plugins/publishings/xhs-pub/src/flow.ts`). A draft run must not click 去发布. Creator drafts stay in `~/.config/kk/browser-profiles/xhs`, not in the phone app.

### Requirements

- [ ] R1. voice2 builds a 发播客 Content whose audio is this episode's mp3 and whose cover is this episode's cover image.
- [ ] R2. The flow clicks 上传音频, fills the form the modal requires, and uploads that mp3 and that cover. It does not import an RSS feed.
- [ ] R3. A draft run does not click 去发布. Re-measure the modal before adding a save control. Persist a creator draft without that click. If the live UI still has no other way to keep the upload, stop before 去发布 and record that gap on the result; do not post the episode.
- [ ] R4. With `xhs_live` unset or false the result must not claim a public post. `plugins/kk/workflows/kk-daily-ai-voice.yaml` stays byte-identical.

### Acceptance Criteria

- [ ] AC1 — The 发播客 note uploads the episode mp3 and cover as one episode

### Q&A

#### Q&A entry — 2026-10-09

- **RSS.** Not supported for this account, and out of scope. One episode per run, uploaded through 上传音频.
- **去发布.** Publish-adjacent. A draft run does not click it. Measured 2026-10-06 as the modal's only advance control; re-measure before inventing a new one.
- **Live post.** Out of scope. `xhs_live` stays false.
- **Where the draft appears.** Only in the XHS browser profile. The phone app will stay empty until a note is actually published.

### Design

Seam: `plugins/publishings/xhs-pub/src/flow.ts` (`PODCAST_OPEN` = 上传音频, `PODCAST_AUDIO_INPUT`, `PODCAST_COVER_INPUT`, `PODCAST_MODAL_ADVANCE` = 去发布) and `validateModeInput` for operation 发播客, which already requires `audio` plus `coverImage`. voice2 does not call this operation today; `dailyPublishXhs` only sends the 上传图文 card series.

Add the 发播客 step beside the 图文 step. Do not replace 图文. Default publish status stays draft (ADR-022).

Verification later: one episode, files attached in the modal, draft visible under 草稿箱 → 播客笔记 in the XHS profile, and no 去发布 click on that run.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
