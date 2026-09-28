---
schema_version: 1
name: CLI resolves kk stage scripts from gitignored apps/cli/plugins — stale-bundle hazard
status: backlog
template: feature-impl
created_at: 2026-09-27T06:00:25.472Z
updated_at: "2026-09-27T06:00:48.603Z"
feature_id: F8

priority: P3
---

## 0178. CLI resolves kk stage scripts from gitignored apps/cli/plugins — stale-bundle hazard

### Background

Filed from E61 re-verify (2026-09-27), 0176 advisory finding.

`resolveStagesScript()` prefers the gitignored packaged copy at `apps/cli/plugins/`, so a fix to
`plugins/kk/scripts/kk-workflow-stages.ts` only takes effect after a manual
`rsync -a --delete plugins/ apps/cli/plugins/`. Forgetting the sync silently runs the stale bundle
and costs a full debugging cycle (this exact failure misattributed the 0176 concat bug for a run
cycle). Acceptance: the CLI either resolves the live source of truth or fails loudly when the
packaged copy diverges (e.g. hash check at load), so a stale bundle cannot run silently.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Derive from the linked feature or refined task scope. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace): `- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`. Do not leave placeholder AC here. -->

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
