---
schema_version: 1
name: "Fix voice2-dag AC1: retry sibling never fires after primary exit-0 without expectFile"
status: todo
template: issue
created_at: 2026-10-14T06:15:17.989Z
updated_at: "2026-10-14T06:39:47.759Z"

---

## 0280. Fix voice2-dag AC1: retry sibling never fires after primary exit-0 without expectFile

### Background

Found while running 0279's quality gate (run dev-runall-0274-0279-3d2a). `apps/cli/tests/voice2-dag.test.ts:844`
AC1 — a primary that exits 0 without its expectFile is recovered by the retry sibling — fails deterministically:
only the `pi` primary is invoked, the `claude` retry sibling never fires (retry raced/dropped at ~1.5–1.9s, well
inside the 180s budget).

Reproduction envelope:

- Fails at worktree HEAD with both tasks' diffs — 5/5 runs (full suite, isolation ×3, filtered ×2).
- Fails at the batch base commit `4eb197b9057427f7ac39e1e1b4d113efce491d20` in a fresh throwaway worktree
  (bun install + single-test run) — pre-existing, not introduced by 0274/0279.
- Contradiction: the identical tree ran the full suite green (2782 tests, 0 fail) at ~22:07 PDT the same
  evening. No code or `~/.config/kk` change in between; suspected time- or environment-dependent race in the
  agent.run recovery scheduling (0238 scope, feature F6 is done — re-parent as needed).
- 0238's AC2–AC4 and every other voice2 test still pass in isolation.

Scope note: filed by the dev-runall batch driver as an out-of-gate-scope follow-up; 0279's gate deviation is
recorded in this batch run's per-tree run record (ADR-131 disposable plane; regenerated per run)`.

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
