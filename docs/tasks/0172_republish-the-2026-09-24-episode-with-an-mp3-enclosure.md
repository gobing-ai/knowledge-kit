---
schema_version: 1
name: Republish the 2026-09-24 episode with an MP3 enclosure
status: todo
template: meta
created_at: 2026-09-25T23:01:10.935Z
updated_at: "2026-09-25T23:10:40.302Z"
feature_id: E61
priority: P0
tags:
  - podcast-pub
  - apple-podcasts
  - live
estimate_hours: 1

dependencies: ["0170", "0171"]
---

## 0172. Republish the 2026-09-24 episode with an MP3 enclosure

### Background

Implements: R4 — The 2026-09-24 episode is republished with a compliant enclosure.

microfeed item IdDo7yGVKuP (https://podcast.salty.vip/i/ai-2026-09-24-IdDo7yGVKuP/) serves a 52 MB audio/wav enclosure — castfeedvalidator: "Cannot Play Most Recent Episode". Design D3 chooses delete + republish (GUID change is harmless because Apple has not ingested the feed yet).

**Refine corrections (2026-09-25)**

- "re-run publish-prep with transcode_mp3=true" → `transcode_mp3` is a `daily-generate` arg (`plugins/kk/workflows/kk-daily-ai-voice.yaml:256`), not publish-prep; the 20260924 run has `mp3Path: null` and `audioPath: …/3-audio/20260924_11_generate_content.intro.wav` (intro already applied, cached) → resolution: transcode that WAV to MP3 with the voice-gen settings (libmp3lame `-qscale:a 2`, `plugins/generations/voice-gen/src/mp3.ts:21`) and set `metadata.mp3Path`; do not regenerate TTS.
- "run date 2026-09-24" → workspace and stage arg are digits-only: `.works/kk-daily-ai-voice/20260924`, `20260924`.
- Stage names → `kk stage daily-publish-prep | daily-publish-podcast | daily-publish-classify | daily-patch-surfdash` (`plugins/kk/scripts/kk-workflow-stages.ts:1799`–`:1814`); publish-podcast skips when `_16_publish-podcast_result.json` already records podcast-pub ok (`:1345`), so that file must be removed first; `_17_publish_result.json` must be re-classified before patch-surfdash reads it (`:1443`).
- "delete, then republish" → reordered to publish-then-delete so a failed publish leaves the old item live.

### Requirements

- [ ] R1. The 20260924 run's `.intro.wav` is transcoded to `.intro.mp3` (libmp3lame `-qscale:a 2`) and `metadata.mp3Path` in `3-audio/20260924_11_generate_content.json` points at it.
- [ ] R2. The episode is republished via `daily-publish-prep` (MP3 + ID3 from 0171) and `daily-publish-podcast`; a new microfeed item exists with an audio/mpeg `.mp3` enclosure.
- [ ] R3. `daily-publish-classify` and `daily-patch-surfdash` re-run so the surfdash cross-link points at the new item URL.
- [ ] R4. After operator confirmation, the WAV item IdDo7yGVKuP is deleted via podcast-pub `operation: delete`.
- [ ] R5. The live RSS has exactly one item, its enclosure is audio/mpeg with a `.mp3` URL, and castfeedvalidator reports no FATAL media error.

Out of scope: code changes (depends on 0170/0171 being merged); the translate/localize stages; any other episode; an in-place media-swap operation.

### Acceptance Criteria

- [ ] AC1 — The 2026-09-24 episode is republished with a compliant enclosure (req: R1, R2, R3, R4, R5)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-25T23:03:57.982Z

- Q: Delete + republish or in-place media swap? A: Delete + republish (design D3); GUID change is harmless pre-Apple-ingest.
- Q: Who authorizes the live delete? A: The operator, explicitly, at execution time — outward-facing action.

#### Q&A entry — 2026-09-25T23:10:32.090Z

- Q: Regenerate audio or reuse the WAV? A: Reuse the cached intro WAV and transcode (closed).
- Q: Order of publish and delete? A: Publish the new item first, then delete the old one (closed).

### Design

Chosen: zero-code, operator-confirmed republish from the cached 20260924 workspace: transcode the existing intro WAV → MP3, point `mp3Path` at it, re-run `daily-publish-prep` → `daily-publish-podcast` (after removing `_16_publish-podcast_result.json`) → `daily-publish-classify` → `daily-patch-surfdash`, then delete IdDo7yGVKuP.
Rejected: re-running `daily-generate` with transcode on (re-synthesizes TTS: slow, different audio); teaching `update` to swap media in place (real code for a one-off); delete-first ordering (a failed publish would leave no episode).
Invariants: live, operator-visible — ask before publish and before `delete`; GUID change is acceptable only because Apple has not ingested the feed.
Dependencies: requires 0170 (guard) and 0171 (MP3 guard + ID3 in `daily-publish-prep`) merged; uses them unchanged.

### Plan

0. Precondition: 0170 and 0171 done and merged; `MICROFEED_*` env present; operator confirms the live actions.
1. `ffmpeg -i …/20260924_11_generate_content.intro.wav -codec:a libmp3lame -qscale:a 2 …intro.mp3`; set `metadata.mp3Path` in `_11_generate_content.json` (R1).
2. `kk stage daily-publish-prep .works/kk-daily-ai-voice/20260924 20260924 "Robin Min" "咸话咸说"`; `rm` `3-publish/20260924_16_publish-podcast_result.json`; `kk stage daily-publish-podcast …`; confirm the new item id/url (R2).
3. `kk stage daily-publish-classify …`; `kk stage daily-patch-surfdash …` (R3).
4. Operator confirms → podcast-pub `operation: delete`, `itemId: IdDo7yGVKuP` (R4).
5. Verify live RSS enclosure + castfeedvalidator; record in Testing (R5).

### Root Cause

<!-- For issue/bug tasks: the verified underlying cause, with a `file:line` anchor. -->

### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
