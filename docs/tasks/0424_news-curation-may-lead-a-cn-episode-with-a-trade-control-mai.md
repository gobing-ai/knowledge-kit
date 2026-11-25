---
schema_version: 1
name: News curation may lead a CN episode with a trade-control mainline the CN platforms block
status: todo
template: issue
created_at: 2026-11-24T21:55:05.683Z
updated_at: "2026-11-24T21:55:38.052Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
---

## 0424. News curation may lead a CN episode with a trade-control mainline the CN platforms block

### Background

2026-11-24 dogfood, measured end to end. The curator authored today's episode around the day's biggest
story — 英伟达董事会恢复黄仁勋职务并新设国家安全与出口管制委员会 — as the lead title, headline and
summary. The variants safety review then graded that mainline against the skill's own conservative
platform stance:

- `xiaoyuzhou` XY-02 (`时政/公共事务主线：政治、外交/贸易管制、军事、公共政策争议…` → block, disposition `escalate`)
- `wechatmp` WX-01 (same shape for 图文)
- `apple-podcasts` AP-02 (evidence gap only — closed the same day by task work on the reference file)

Result: `bundle.safety.excludedPlatforms = [xiaoyuzhou, apple-podcasts, wechatmp]`, so
`podcast-pub.episode` and `wechatmp-pub.文章` were dropped for the day *after* the full TTS pass had
already been paid for (12.6 min of audio, 753 s). The operator accepted the exclusion rather than
override it; the episode shipped only to surfdash + 视频号 audio + jike.

The pipeline behaved as designed — the gap is upstream. The editorial selection never considers the
CN distribution surface it is writing for, so the cheapest-looking lead (the biggest story) can be the
one that costs the day its primary channel.

Evidence: `.works/kk-news-generate/20261124/4-safety-variants/20261124_09_safety-review_report.json`
(per-platform findings with `disposition: escalate`), `4-safety-variants/safety.json`
(`excludedPlatforms`), and the publish plan (`4-publish/plan.after-generate.json`, two rows
`excluded by bundle safety`).

### Requirements

- [ ] R1. The news-editorial selection contract must name the CN-platform constraint explicitly: a mainline that is 时政/贸易管制/公共安全审查 (state security review, export controls, foreign-intelligence framing) must not be the episode's lead title, headline or summary for a CN-distributed cut.
- [ ] R2. When such a story is the day's biggest, the selection must either demote it to a body item with a neutral headline or produce two cuts (CN lead vs overseas lead) — the chosen behaviour is recorded with its tradeoff.
- [ ] R3. A deterministic check (not a prose instruction only) must fail the plan when the lead title/summary trips the CN-blocked mainline vocabulary on the CN cut.
- [ ] R4. The failure must be visible before the TTS spend, not only in the post-spend safety verdict.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a state-security lead is refused before synthesis (req: R1, R3, R4)
Given a plan whose lead title is `…国家安全与出口管制委员会` on the CN cut
When the plan is authored and the pre-spend gate runs
Then the plan check fails (or rewrites the lead) naming XY-02/WX-01 as the rule, and no audio is synthesized

Scenario: AC2 — a product lead passes untouched (req: R1)
Given a plan whose lead is a model/product release
Then the check passes and the run continues to the floor gate
```

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

- Safety report: `.works/kk-news-generate/20261124/4-safety-variants/20261124_09_safety-review_report.json`
- Skill refs: `plugins/kk/skills/content-safety/references/platforms/xiaoyuzhou.md` (XY-02), `wechatmp.md` (WX-01)
- Selection contract: `plugins/kk/skills/news-editorial/references/selection.md`, `style-contract.zh.md`
- Cost of the miss: 12.6 min TTS pass (`30-audio/`) with the two CN rows excluded

### History
