---
schema_version: 1
name: Decide and encode the thin-day episode policy instead of closing the day silently
status: todo
template: issue
created_at: 2026-10-12T21:45:46.907Z
updated_at: "2026-10-12T21:58:58.177Z"
feature_id: G11

ac_altitude: task-local
---

## 0266. Decide and encode the thin-day episode policy instead of closing the day silently

### Background

`docs/04_DESIGN.md` and the 2026-10-12 pre-spend floor gate make a thin news day close as `no-content`: `kk stage daily-qc-content` empties the pool when the kept set's estimated spoken length cannot reach `episode_min_minutes`, "instead of paying for a synthesis pass that `daily-episode-duration` then refuses". So on a quiet day the product publishes nothing, and the operator learns nothing actionable from the workflow exit alone.

Measured on 2026-10-12 after the label fix: `kk store extract --topic ai-news --window 24h` returned 3 items, and 4 with the importance-only backfill — every one of the day's other candidates failed a hard dimension (`kk-item-quality >= 2` on stub-length bodies, `kk-item-category` allowlist). The operator override `episode_min_minutes=8` was needed to publish anything that day.

The open question is a product decision, not a bug: on a genuinely thin day, is the right answer (a) a shorter episode, (b) a wider extract window (96h reaches 7 items, at the cost of 3-4 day old, never-published backlog), or (c) no episode — and in case (c) what the operator sees and can act on.

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
