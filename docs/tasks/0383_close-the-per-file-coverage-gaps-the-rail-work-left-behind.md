---
schema_version: 1
name: Close the per-file coverage gaps the rail work left behind
status: todo
template: issue
created_at: 2026-11-17T07:16:49.654Z
updated_at: "2026-11-17T07:16:49.854Z"
feature_id: A22

---

## 0383. Close the per-file coverage gaps the rail work left behind

### Background

Captured from the creation title: "Close the per-file coverage gaps the rail work left behind".

### Requirements

- [ ] R1. **threads-pub post rail** — `plugins/publishings/threads-pub/src/post-rail.ts` is at 12.50% funcs / 14.73% lines (body 146-353 uncovered). Add the fake-page suite its x sibling already has (`plugins/publishings/x-pub/tests/post-rail.test.ts`, 663 lines), covering the composer, session and receipt paths, so the file clears the 90% floor.
- [ ] R2. **shipinhao audio flow** — `plugins/publishings/shipinhao-pub/src/audio-flow.ts` is at 86.67% funcs / 100% lines: one function is never called by its test. Cover it or delete it if it is dead.
- [ ] R3. **Gate evidence** — `spur task gate --wbs <new>` (qualityGateCmd set) reports no coverage shortfall, so `spur task gate` for any unrelated task stops failing on these two rows (`scanCoverageShortfalls` flags every below-floor row in the log, not only changed files).

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [ ] 1. threads-pub fake-page suite (R1)
- [ ] 2. audio-flow uncovered function (R2)
- [ ] 3. Full gate run with no coverage shortfall (R3)

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
