---
schema_version: 1
name: Repoint the Board daily-voice module at the kk-news-generate layout
status: backlog
template: feature-impl
created_at: 2026-11-16T04:13:48.017Z
updated_at: "2026-11-16T04:14:02.779Z"

ac_altitude: task-local
ac_numbering: task-local
---

## 0384. Repoint the Board daily-voice module at the kk-news-generate layout

### Background

Captured from the creation title: "Repoint the Board daily-voice module at the kk-news-generate layout".

### Requirements

- [ ] R1. Point `apps/board`'s daily-voice module at the current workflow family and run layout: `kk-news-generate`, phase directories `10-collect` … `5-report`, `pool-gate.json` and `schedule-receipt.json`, replacing the `kk-daily-ai-voice2` gate and artifact map.
- [ ] R2. Show a day that only ran under the retired layout as retired — with the layout it used — instead of claiming it has no run.
- [ ] R3. Resolve the run directory through the same works-root rules `kk` uses (config `works_dir`, then cwd fallback) rather than a hardcoded path, so a Board started from any cwd reads the live works root.
- [ ] R4. Cover it with tests: the current-layout tree for today's run, and a retired-layout day that renders as retired.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The Board shows the current layout (req: R1)
  Given a day that ran under kk-news-generate
  When the daily-voice module renders
  Then it lists that run with its phase directories, pool gate and schedule receipt
  And it reads no kk-daily-ai-voice2 artifact

Scenario: AC2 — A retired-layout day is shown as retired (req: R2)
  Given a day whose only run directory is a retired layout
  When the module renders
  Then it reports that day as retired, naming the layout
  And it never reports the day as having no run

Scenario: AC3 — The works root resolves like kk's (req: R3)
  Given a Board process started from an unrelated cwd
  When the module resolves today's run directory
  Then it uses the configured works root
  And falls back to the cwd-relative default only when none is configured

Scenario: AC4 — Both layouts are pinned by tests (req: R4)
  Given the current-layout tree and a retired-layout day
  When the module's tests run
  Then each renders the expected shape
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
