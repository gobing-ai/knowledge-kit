---
schema_version: 1
name: Bind WeChat Channels cards to the confirmed Official Account article
status: todo
template: feature-impl
created_at: 2026-11-18T04:49:21.260Z
updated_at: "2026-11-18T04:50:05.961Z"
feature_id: L3
priority: P1

estimate_hours: 5
dependencies: ["0388"]
---

## 0395. Bind WeChat Channels cards to the confirmed Official Account article

### Background

The daily preset already defines shipinhao-pub/image with generic cards (plugins/kk/publish-presets/daily-ai-voice.json:126). The generic article placeholder resolves SurfDash (apps/cli/src/publish-matrix.ts:469). A WeChat draft has no confirmed public article URL.

### Requirements

- [ ] R1. Gate the existing Channels image target on the verified Official Account article for the same episode, and carry that URL plus the approved card payload (L3 R18).
- [ ] R2. Defer only that target when the link is missing or unsafe, preserve configured modes, and retry using existing target receipts.

### Acceptance Criteria

- [ ] R18 — 视频号卡片只使用已确认的公众号文章链接

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-18T04:50:05.568Z

**Ready decisions.** Consume 0388 target dependency and receipt contracts. Scope changes to the existing image operation and its variant. A prepared draft has no eligible link; an operator-confirmed public link must carry same-episode identity and safe URL verification. Targets retain their current configured modes. A dry or fake transport is enough to verify behavior when live access is absent.

**Source premise.** `plugins/kk/publish-presets/daily-ai-voice.json:126` and the L3 design's corresponding section were checked during refinement.

**Verification exit.** Replay draft, bad link, different episode, approved same-episode link and a retry. Record dependency classification and downstream delivery outcome for 0389.

### Design

Own the shipinhao-pub image payload and target dependency binding after 0388. Accept a verified public URL from existing WeChat results where available, or an operator-supplied URL through the existing receipt/recovery path if a draft was manually released. Bind it to the same episode/bundle and verify the allowed platform destination at the trusted boundary. Generic card and article variants retain their existing behavior. Any URL missing, unverified or pointing to an unrelated episode produces a visible non-send outcome. Adopt the channel’s existing approved link mechanism if supported; if a clickable attachment is unavailable, use the official URL in the caption when allowed and record that distinction. Keep off/dummy/draft/live unchanged.

### Plan

- [ ] Add fake transport fixtures for draft, published but unverified, verified same-episode link, mismatched episode and retry.
- [ ] Prepare the scoped card payload, dependency evidence and manual release handoff. Reuse existing classification and retry.
- [ ] Capture the target plan, payload and receipt in a repeatable rehearsal. Check unrelated targets and duplicate suppression.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
