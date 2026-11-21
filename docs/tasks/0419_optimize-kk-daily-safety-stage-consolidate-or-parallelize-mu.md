---
schema_version: 1
name: "Optimize kk-daily-safety stage: consolidate or parallelize multi-platform review passes"
status: todo
template: issue
created_at: 2026-11-21T03:56:38.022Z
updated_at: "2026-11-21T03:58:43.399Z"
feature_id: F61

tags: ["perf", "safety", "deferred"]
ac_altitude: task-local
ac_numbering: task-local
---

## 0419. Optimize kk-daily-safety stage: consolidate or parallelize multi-platform review passes

### Background

In `.works/kk-news-generate/ledger.md`, the `safety` stage (`kk-daily-safety`) takes **12 to 17 minutes** per daily run. Deferred (P3) behind host memory reclamation (`0415`) and audio pipeline hardening (`0416`, `0417`).

### Requirements

- [ ] R1. Consolidate independent multi-platform safety review/judge evaluations into a single structured LLM call or bounded parallel per-platform calls.
- [ ] R2. Preserve the existing safety report schema (`*_safety-review_report.json`) and variant revision guarantees (no weakening of platform safety gates).
- [ ] R3. Reduce `safety` stage wall time from 12-17 min to target <= 2-3 min, verified on a real run.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Faster multi-platform safety evaluation with identical contract (req: R1, R2, R3)
  Given a daily script/article set targeting 3 platforms
  When `kk-daily-safety` runs
  Then all 3 platform assessments and any required revisions complete in <= 3-4 min and emit valid `*_safety-review_report.json` artifacts
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

- Compare two options during implementation: (a) single structured multi-platform rubric prompt returning per-platform verdicts in one round trip, or (b) `Promise.all` with bounded concurrency (3) across platforms when they share the same source draft.
- Preserve per-platform revision only for platforms that fail the judge gate (skip unnecessary second passes).

### Plan

1. [ ] Inspect `kk-daily-safety` workflow and stage runner to map exact LLM call count and latency per platform.
2. [ ] Implement consolidated structured evaluation or bounded parallel per-platform review/judge execution.
3. [ ] Verify report schema compatibility with existing tests and `bun run gate`.
4. [ ] Sync `plugins/kk/scripts/` + workflows and benchmark wall time on a daily run.

### Root Cause

`kk-daily-safety` executes an iterative state-machine loop (`review -> judge -> revise`, up to 2 passes) sequentially across 3 target platforms, issuing multiple sequential multi-thousand-token LLM round trips even when platform evaluations are independent.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `.works/kk-news-generate/ledger.md` (12-17 min `safety` timings)
- `.works/kk-news-generate/20261119/4-safety-variants/20261119_09_safety-review_report.json`

### History
