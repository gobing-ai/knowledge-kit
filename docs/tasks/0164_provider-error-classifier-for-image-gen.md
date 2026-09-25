---
schema_version: 1
name: provider error classifier for image-gen
status: backlog
template: feature-impl
created_at: 2026-09-25T18:06:10.483Z
updated_at: "2026-09-25T18:17:45.873Z"
feature_id: D6

---

## 0164. provider error classifier for image-gen

### Background

Captured from the creation title: "provider error classifier for image-gen".

### Requirements

- [ ] R1. Classify provider execution errors into auth / quota / transient / policy / unknown, exported from the providers layer (`plugins/generations/image-gen/src/providers/`).
- [ ] R2. Classification is pure (error → class) and covers observed provider error shapes: 401/403 → auth, 429/quota-exceeded → quota, timeout/network → transient, content-flag response → policy.
- [ ] R3. Unit tests per class plus the unknown fallback class; classifier output drives feature scenarios "Content-policy rejections never fall back" and "Exhausted fallback order fails loudly" (class appears in the failure message).

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
