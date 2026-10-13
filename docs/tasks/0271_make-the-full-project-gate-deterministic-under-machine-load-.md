---
schema_version: 1
name: Make the full project gate deterministic under machine load (three load-sensitive fixtures)
status: cancelled
template: issue
created_at: 2026-10-13T01:34:08.731Z
updated_at: "2026-10-13T20:56:47.718Z"

---

## 0271. Make the full project gate deterministic under machine load (three load-sensitive fixtures)

### Background

This task was a short-lived diagnostic for load-sensitive failures observed in three existing test
fixtures during the 2026-10-12/13 project-gate runs. It has no independent product behavior or
remaining implementation scope.

**Refine corrections (2026-10-13).**

- The fanout fixture's timing split is already in `fefd9808`, the stage fixture's child-process build
  is already in `741a0cb5`, and the installed-Board Settings link wait is already in `32182b55`.
- The three scoped regressions pass on the current tree. The earlier failure counts, host-load
  measurements, and proposed root-cause theories are retained only in repository history, not as
  current requirements or implementation guidance.
- This cross-cutting diagnostic is intentionally left without a feature link; no unrelated feature
  owns a gate-health report.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. [x] Confirm the fanout fixture fix in `fefd9808`, the stage-fixture fix in `741a0cb5`, and the
   installed-Board wait fix in `32182b55` against the current tree.
2. [x] Run the three scoped regressions; each passed with 0 failures.
3. [x] Cancel this stale cross-cutting diagnostic; future gate flakes must be filed from fresh
   evidence under the owning feature or surface.

### Root Cause

Historical observation only: before the fixes named in Background, the three fixtures could fail under
the recorded gate conditions. The current tree passes their scoped regressions, so no root-cause claim
or repair remains open under this task. File a future failure from fresh evidence under the fixture's
owning task or feature.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-13 refinement: cancelled as stale after fanout, stage-fixture, and installed-Board targeted
  checks passed against the fixes listed in the Background corrections. No production implementation
  was made in this corpus pass.
- 2026-10-13T20:55:38.221Z todo → cancelled (system)

