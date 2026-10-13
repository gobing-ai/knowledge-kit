---
schema_version: 1
name: Decide and encode the thin-day episode policy instead of closing the day silently
status: todo
template: issue
created_at: 2026-10-12T21:45:46.907Z
updated_at: "2026-10-13T02:47:00.852Z"
feature_id: G11

ac_altitude: task-local
---

## 0266. Decide and encode the thin-day episode policy instead of closing the day silently

### Background

`docs/04_DESIGN.md` and the 2026-10-12 pre-spend floor gate make a thin news day close as `no-content`: `kk stage daily-qc-content` empties the pool when the kept set's estimated spoken length cannot reach `episode_min_minutes`, "instead of paying for a synthesis pass that `daily-episode-duration` then refuses". So on a quiet day the product publishes nothing, and the operator learns nothing actionable from the workflow exit alone.

Measured on 2026-10-12 after the label fix: `kk store extract --topic ai-news --window 24h` returned 3 items, and 4 with the importance-only backfill — every one of the day's other candidates failed a hard dimension (`kk-item-quality >= 2` on stub-length bodies, `kk-item-category` allowlist). The operator override `episode_min_minutes=8` was needed to publish anything that day.

The open question is a product decision, not a bug: on a genuinely thin day, is the right answer (a) a shorter episode, (b) a wider extract window (96h reaches 7 items, at the cost of 3-4 day old, never-published backlog), or (c) no episode — and in case (c) what the operator sees and can act on.

**Refine corrections (2026-10-12)**

- R3 "make the outcome observable in run-report" → confirmed gap, and narrower than stated: `kk daily run-report` already writes `no-content`, but when the floor gate empties the candidates it reports `content QC admitted zero of the pooled items` (`apps/cli/src/commands/daily.ts:413-417`) — it never reads the floor-refusal artifact `21-plan/<date>_04_quality-control-content_floor-refusal.json` (`plugins/kk/scripts/daily-stages.ts:251-263`), so the estimate, floor and counts are lost from the report → R3 keeps its scope, re-pointed at that artifact.
- AC2 "no run can pass the floor and then fail `daily-episode-duration`" → not achievable as worded: the floor is a heuristic estimate (`SPEAK_CHAR_EXPANSION = 1.4`, calibrated on two runs, `daily-stages.ts:221`) while the duration gate measures the rendered MP3 and `failWith(1)`s (`daily-stages.ts:478-483`), aborting the run before run-report/ledger. Agreement can only be bounded (estimate margin) or the post-spend refusal routed to run-report like a no-content close → AC2 must be restated once the policy decision (Q&A D1) is made.
- Live workflow: the 04:30 job runs `kk-daily-ai-voice2.yaml` (`episode_min_minutes: "15"`, `episode_max_minutes: "25"`, `qc_min_episode_items: "8"`, lines 70-83); the floor gate sits in `daily-qc-content`, the measured gate in node `duration` (line 537).

### Requirements

- [ ] R1. Record the chosen thin-day policy as a dated decision (ADR entry or the design doc's episode-window section), stating the threshold that separates "short episode" from "no episode".
- [ ] R2. Implement the chosen behaviour in the QC/floor path and keep the estimate and the measured `daily-episode-duration` gate in agreement, so a day cannot pass the pre-spend floor and then be refused after the synthesis spend.
- [ ] R3. Make the outcome observable in `run-report` (`no-content` plus the reason and the eligible/kept counts), so an operator can tell a quiet news day from a broken ingest without reading the store.
- [ ] R4. Cover the chosen branch with a test that fails before the change — the floor gate is the only thing standing between a thin pool and a paid synthesis pass.

### Acceptance Criteria

- [ ] AC1 — A day whose kept set cannot reach the floor follows the recorded policy end to end, with the run-report naming the reason and the counts. (req: R1, R2, R3)
- [ ] AC2 — No run can pass the pre-spend floor and then fail `daily-episode-duration` for the same estimated length. (req: R2)
- [ ] AC3 — The regression test fails against the pre-change code. (req: R4)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-13T02:47:00.851Z

- **D1 (OPEN — operator decision, blocks Design/Plan).** On a day whose kept set estimates below `episode_min_minutes` (15), what ships?
  - (a) **Short episode** — lower the floor to a "short-episode" threshold (e.g. 8 min, the 2026-10-12 manual override) and keep 15 as the target, not the gate. Cost: a thinner product some days; the duration gate's minimum moves with it.
  - (b) **Wider window fallback** — re-extract with a wider `--window` (96h reached 7 items on 2026-10-12) before giving up. Cost: 3–4-day-old items in a "daily" show; one extra extract per thin day.
  - (c) **No episode (status quo)** — keep 15 as a hard floor; only fix R3 observability and the post-spend abort. Cost: silent product days continue, but they are now explained.
  - Refiner recommendation: **(c) + R3**, with (a) as the follow-up if thin days recur weekly — it is the only option that needs no new product judgment and fixes the "operator learns nothing" half today. Not closed under `--auto`: this is a product policy, not an evidence question.
- D2 (deferred to D1) — Restate AC2: estimate margin vs routing a post-spend `daily-episode-duration` refusal into run-report/ledger.

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
