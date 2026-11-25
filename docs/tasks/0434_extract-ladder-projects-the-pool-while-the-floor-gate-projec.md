---
schema_version: 1
name: Extract ladder projects the pool while the floor gate projects the admitted set
status: todo
template: issue
created_at: 2026-11-24T21:55:06.445Z
updated_at: "2026-11-24T21:55:48.591Z"
feature_id: L3

ac_altitude: task-local
ac_numbering: task-local
---

## 0434. Extract ladder projects the pool while the floor gate projects the admitted set

### Background

Two gates estimate the same episode with two different denominators, and the numbers a human reads
during recovery disagree by 10x.

2026-11-24 measured on one run (`.works/kk-news-generate/20261124`):

| Artifact | What it says | Arithmetic |
|---|---|---|
| `10-collect/ladder.json` | `items 63, chars 42925, minutes 22.8, clears: true` at the 168h rung | poolChars x 0.165 (yesterday's spoken/pool ratio) |
| `21-plan/…_floor-refusal` inputs (gate) | 12,937 kept chars -> 13.1 min | keptChars x 0.313 (yesterday's spoken/kept ratio) |
| `30-audio/…_duration-refusal.json` | `measuredMinutes: 12.6`, `estimatedMinutes: 58.2` | keptChars x **1.4** (the pre-2026-11-16 raw-script expansion) |

So the ladder said 22.8 min, the pre-spend gate said 13.1, the writer delivered 12.6, and the
post-spend refusal printed 58.2 next to it.

The 58.2 is fixed (commit ecf5cb1e: `dailyEpisodeDuration` now passes `readKeptRatio(workDir).ratio`,
so both gates share one arithmetic and a test at
`plugins/kk/tests/daily-publish-path-0329.test.ts` pins it).

What remains is the ladder-vs-gate gap. The ladder multiplies the *raw pool* by a *pool-denominated*
ratio, which is only equivalent to the gate's kept-set arithmetic when today's QC keep rate matches
the day the ratio was recorded. Meantime the keep rate moved 7 points (53% -> 46%), so 63 pool items
(42.9k chars) forecast 22.8 min while the admitted 18 items (12.9k chars) could only make 13.1 — the
run cleared the floor by 0.1 min and then measured 12.6, i.e. under it. Raising `plan_max_items`
40 -> 64 for this run bought 225 chars of kept content, because QC kept the same 18 docs.

Consequence: the widen ladder is not a usable predictor of the episode's length, and the day's
recovery decision (re-curate? lower the floor? re-voice?) has to be made from numbers that contradict
each other.

### Requirements

- [ ] R1. The extract ladder and the floor gate must estimate with the same denominator: either the ladder projects the admitted set (pool chars x the recorded keep rate x the recorded kept ratio) or it states the keep-rate assumption it used.
- [ ] R2. Every estimate artifact must print the ratio, its source path and the assumed keep rate, so two artifacts can be compared without recomputation.
- [ ] R3. A keep-rate drift beyond a stated bound (the QC admission rate moving several points from the day the ratio was recorded) must be reported, not silently absorbed into the estimate.
- [ ] R4. A test pins the ladder/gate/settle arithmetic on one fixture, so a future change to either side fails the suite.

### Acceptance Criteria

```gherkin
Scenario: AC1 — ladder and gate agree on one fixture (req: R1, R4)
Given a pool fixture and a recorded `21-plan/<date>_09_spoken-ratio.json` with both `ratio` and `keptRatio`
When the ladder and the floor gate both estimate
Then both artifacts report minutes that differ by no more than the fixture's keep-rate uncertainty, and the test fails if either side switches denominator

Scenario: AC2 — a keep-rate shift is named (req: R3)
Given a run whose QC admission rate is 7 points below the recorded day
Then the ladder artifact records the assumption and the run reports the drift on stderr
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

- `plugins/kk/scripts/daily-stages.ts`: `dailyExtract` (ladder), `applyFloorGate`, `estimateSpokenMinutes`, `readKeptRatio`, `recordSpokenRatio`
- Measured artifacts: `.works/kk-news-generate/20261124/10-collect/ladder.json`, `30-audio/20261124_11_generate_content_duration-refusal.json`
- Prior fix for the same class: task 0377 (double discount), commit ecf5cb1e (post-spend ratio)
- `.spur/context/learnings.md` 2026-11-16: "One ratio, two denominators is a silent double discount"

### History
