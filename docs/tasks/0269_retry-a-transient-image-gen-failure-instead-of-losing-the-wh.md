---
schema_version: 1
name: Retry a transient image-gen failure instead of losing the whole XHS card series
status: todo
template: issue
created_at: 2026-10-12T23:05:01.141Z
updated_at: "2026-10-13T05:36:44.632Z"
feature_id: G11

ac_altitude: task-local
---

## 0269. Retry a transient image-gen failure instead of losing the whole XHS card series

### Background

Captured from the creation title: "Retry a transient image-gen failure instead of losing the whole XHS card series".

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Implemented in 1742d6e7 (2026-10-12 hardening pass), as R1's bounded same-envelope retry:

- `plugins/kk/scripts/daily-stages.ts:2509-2526` — the retry loop branches on `xhsOverflowPoints`: a `null` (no overflow sentence in the child's stderr) now retries the SAME envelope once, guarded by the `transientRetryUsed` flag, and logs `xhs render: card <NN> failed without a safe-area overflow — retrying the same envelope once (exit <status>)`. The overflow path keeps its 3 rewrites and both budgets share the loop bound (`XHS_OVERFLOW_ATTEMPTS`).
- Tests at `apps/cli/tests/kk-workflow-stages.test.ts:1806` (`retries a non-overflow failure once and recovers the card`) assert status 0, exactly one retry for the first card and byte-identical envelopes (a rewrite would have taken the overflow branch); the companion case asserts the bound for a persistent failure (2 calls, resume line, no `cards.json`). `fakeXhsKkFailFirst` gained a `failCalls` parameter, and the two callers that encoded 0251 R2's "one call" expectation (0251 AC2, 0219 AC2) were updated to the new contract. Falsified: reverting the stage branch fails 3 tests.

**R3 is satisfied in its bounded form, not by classification.** The implementation does not try to separate a transient provider failure from a permanent misconfiguration: it retries once for any non-overflow failure, so a permanently broken card costs one extra illustration (not N) before the series stops, which is AC3. Classifying the two from image-gen's stderr was rejected as unreliable — the observed transient failure's own message ended in a vendor-fallback warning, which reads like a configuration cause.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
