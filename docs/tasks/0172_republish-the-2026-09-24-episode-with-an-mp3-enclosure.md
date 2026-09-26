---
schema_version: 1
name: Republish the 2026-09-24 episode with an MP3 enclosure
status: todo
template: meta
created_at: 2026-09-25T23:01:10.935Z
updated_at: "2026-09-26T00:29:45.274Z"
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

Implements: R4 — The 2026-09-25 episode is published with a compliant enclosure.

After 0170 (podcast-pub rejects non-Apple-compatible audio before any network call), 0171
(kk-daily-ai-voice publishes MP3 by default with ID3 tags), and 0173 (Apple-compliant channel
artwork + operator checklist) are merged, kick off the daily AI-voice generation for
**2026-09-25** and publish it. This episode is the first published through the fixed path, so it
doubles as the live end-to-end acceptance for 0170/0171.

**Supersedes the 2026-09-24 republish (operator decision, 2026-09-25).** The original scope —
transcode the cached `20260924` intro WAV and republish item `IdDo7yGVKuP` — is dropped. The
deliverable is a fresh 2026-09-25 episode, not a repaired 2026-09-24 one: no cached-workspace
surgery, no `operation: update` media swap. The existing 2026-09-24 item stays live serving an
`audio/wav` enclosure; that residual is recorded in E61 Notes, not repaired here.

### Requirements

- [ ] R1. The `20260925` daily run publishes MP3 by default (no `transcode_mp3` override) and the final episode MP3 carries ID3 title, artist, album, and date tags (0171).
- [ ] R2. `daily-publish-prep` then `daily-publish-podcast` publish the episode to microfeed; the new item's enclosure is `audio/mpeg` with a `.mp3` URL, and the 0170 MIME guard does not refuse it.
- [ ] R3. `daily-publish-classify` and `daily-patch-surfdash` re-run so the surfdash cross-link points at the new item URL.
- [ ] R4. The live RSS feed's most recent item is the 2026-09-25 episode with an `audio/mpeg` `.mp3` enclosure, and castfeedvalidator reports no FATAL media error for the feed.
- [ ] R5. The operator confirms the live publish before the microfeed request is made.

Out of scope: code changes (delivered by 0170/0171/0173); the disposition of the 2026-09-24 item; channel-level settings (0173 checklist); the translate/localize stages.

### Acceptance Criteria

- [ ] AC1 — The 2026-09-25 episode is published with a compliant enclosure (req: R1, R2, R3, R4, R5)

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

Chosen: let the fixed daily path do the work end to end — run the 2026-09-25 generation with the
new defaults (MP3 + ID3), publish through `daily-publish-prep` → `daily-publish-podcast`, then
`daily-publish-classify` → `daily-patch-surfdash`. This is the live acceptance exercise for
0170/0171: no bespoke transcode, no cached-workspace surgery, no in-place media swap.

Rejected: repairing the 2026-09-24 episode (operator decision 2026-09-25 — publish 09-25 instead);
the manual transcode + republish design this task previously carried (it does not exercise 0171's
defaults, and it repairs the wrong episode); publishing before 0170/0171 merge (the point is to
prove the fixed path).

Invariants: live and operator-visible — ask before the microfeed publish request.
Dependencies: requires 0170 (MIME guard) and 0171 (MP3 default + ID3) merged; uses them unchanged.

### Plan

0. Precondition: 0170 and 0171 done and merged; `MICROFEED_*` env present; operator confirms the live publish.
1. Kick off the 2026-09-25 daily AI-voice generation (workspace `.works/kk-daily-ai-voice/20260925`, stage arg `20260925`) with defaults; confirm the generated episode is MP3 and carries ID3 tags (R1).
2. `kk stage daily-publish-prep .works/kk-daily-ai-voice/20260925 20260925 "Robin Min" "咸话咸说"`; then `kk stage daily-publish-podcast …`; confirm the new item id/url and its `audio/mpeg` enclosure (R2).
3. `kk stage daily-publish-classify …`; `kk stage daily-patch-surfdash …` (R3).
4. Verify the live RSS most-recent item and run castfeedvalidator; record the outcome in Testing (R4).

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
