---
schema_version: 1
name: The 上传图文 note pairs each generated image with its text
status: backlog
template: feature-impl
created_at: 2026-10-09T06:24:08.232Z
updated_at: "2026-10-09T06:25:38.811Z"
feature_id: G12

priority: P2
---

## 0235. The 上传图文 note pairs each generated image with its text

### Background

Feature G12 scenario R1. On 2026-10-09 the operator emptied the Xiaohongshu creator draft box because the saved drafts were wrong. 每日AI乱炖 still needs an 上传图文 note, and that note has to spend the images this episode already generates, each with text that matches the image.

Creator drafts are stored in the browser profile `~/.config/kk/browser-profiles/xhs`. The phone app and any other browser show an empty box. The console itself says the drafts are deleted when that browser's data is cleared. Review the result in this profile.

F616 (done) typesets card copy with real type. Do not add a second text renderer. Important, not urgent: leave `xhs_live` false.

### Requirements

- [ ] R1. The 上传图文 note attaches this episode's generated images in a declared order. Start from the files voice2 already writes (the cover under `23-cover`, the card series under `25-xhs/cards`). Do not generate a new image set when those files can carry the note.
- [ ] R2. Every attached image has matching text. Typeset card copy stays on the card. An illustration that must stay text-free gets its words in the note body or on the typeset card, not painted into the picture. If an existing image cannot serve that role (garbled glyphs, no place for its sentence), change that image's generation and record why.
- [ ] R3. `xhs-pub` saves the note as operation 上传图文. With `xhs_live` unset or false the run does not click 发布, and the result says `publishStatus: draft` only after the creator console shows a save signal.
- [ ] R4. `plugins/kk/workflows/kk-daily-ai-voice.yaml` stays byte-identical. Any command or stage surface that names the image order or the text pairing is updated in the same change.

### Acceptance Criteria

- [ ] AC1 — The 上传图文 note pairs each generated image with its text

### Q&A

#### Q&A entry — 2026-10-09

- **Which images.** Use the cover and the XHS card series this episode already generates. Add or regenerate an image only when one of those cannot carry its role.
- **Lead-item series.** F615's lead-item-only plan is the old contract. This note covers the episode's images.
- **Live post.** Out of scope. `xhs_live` stays false.
- **Deleted drafts.** Do not recreate the notes the operator deleted on 2026-10-09.

### Design

Seam: `xhs-write` / `xhs-render` / `xhs-publish` in `plugins/kk/workflows/kk-daily-ai-voice2.yaml`, stages `dailyXhsRender` and `dailyPublishXhs` in `plugins/kk/scripts/daily-stages.ts`, and `xhs-pub` operation `上传图文`.

F615 planned the series from the lead item only. This task replaces that selection for 每日AI乱炖: use the episode's generated images, not a single lead card. F616 already owns legible card type; call it, do not reimplement it.

The 2026-10-08 dogfood left card PNGs able to carry Chinese and illustration JPGs that must not rely on generated glyphs. Keep that split unless a measured image proves otherwise.

Verification later: one voice2 episode, draft only, then read 草稿箱 → 图文笔记 in the XHS profile. Do not treat the phone app as evidence.

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
