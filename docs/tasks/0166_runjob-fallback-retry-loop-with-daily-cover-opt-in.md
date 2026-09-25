---
schema_version: 1
name: runJob fallback retry loop with daily-cover opt-in
status: backlog
template: feature-impl
created_at: 2026-09-25T18:06:11.062Z
updated_at: "2026-09-25T18:17:45.873Z"
feature_id: D6

dependencies: ["0164", "0165"]
---

## 0166. runJob fallback retry loop with daily-cover opt-in

### Background

Captured from the creation title: "runJob fallback retry loop with daily-cover opt-in".

### Requirements

- [ ] R1. Wire classifier + resolved order into `runJob`: on a retryable error class, emit a WARN log naming failed provider, error class, and next provider **before** the paid retry (feature scenario "fallback true retries down AUTO_ORDER after a loud log").
- [ ] R2. Policy-class errors stop the loop with the classified reason; an exhausted order fails listing every attempted provider with its class (feature scenarios "Content-policy rejections never fall back", "Exhausted fallback order fails loudly", "No fallback field keeps today's strict failure").
- [ ] R3. Artifact metadata records failed attempts (provider, error class) and the winning provider.
- [ ] R4. `daily-cover` stage writes an optional `cover_fallback` workflow var into the built envelope (default absent = strict); `docs/04_DESIGN.md` § image-gen envelope surface row lands in the same commit (T3).

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
