---
schema_version: 1
name: Calibrate the CN-lead gate against held-out lead families (recall 22/30, product false positives 12%)
status: todo
template: issue
created_at: 2026-11-25T16:39:32.284Z
updated_at: "2026-11-25T16:39:33.556Z"
feature_id: L3

ac_numbering: task-local
ac_altitude: task-local
---

## 0437. Calibrate the CN-lead gate against held-out lead families (recall 22/30, product false positives 12%)

### Background

A deterministic CN-lead gate exists (`plugins/kk/scripts/cn-lead-gate.ts`, wired into `daily-curate-check`
before synthesis, 0433), but six review rounds measured that its coverage is calibration work, not a
one-shot table.

Held-out measurements (each from a fresh reviewer pass, leads authored for that pass):

- v4: 15/42 class leads passed, 10 materially in class.
- v5: 22/30 passed (73%), all 8 materially in class; and the widening cost precision — 10/86 fresh
  product leads demoted (12%): Apache `许可`, code `审查`, vendor postmortem `调查`, product `限制`,
  and `新规` matching across a morpheme boundary in 更新规范.
- v5 sized the fix: extending the object/adjudication tables (E1) and the administrative-instrument
  predicate (E3) takes recall to 29-30/30 and product precision to 92%, with all 32 shipped fixture
  rows still correct.

Residual gaps named by v5: 指引 / 条例 / 细则 / 备案 / 征求意见 / 供应 / bare 管制 absent from the
vocabulary; the product-policy carve-out cancels on generic government words, so `教育部` / `央行` /
`数据局` fail to cancel while a company's `安全部门` does.

Acceptance for this task:
- a held-out measurement of >= 28/30 class leads caught, with <= 3/86 product-lead false positives,
  reproduced by a committed fixture table (not an ad-hoc probe);
- no path where a false positive refuses the whole day before synthesis (`enforceCnLead`'s
  all-candidates-tripped refusal must require an enumerated strong-class hit, not a two-signal match);
- the measurement method (fixture families both directions) committed so the next change is judged
  against it rather than against new anecdotes.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
