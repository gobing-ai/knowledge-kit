---
schema_version: 1
name: fallback envelope field and order resolution
status: backlog
template: feature-impl
created_at: 2026-09-25T18:06:10.765Z
updated_at: "2026-09-25T18:17:45.873Z"
feature_id: D6

dependencies: ["0164"]
---

## 0165. fallback envelope field and order resolution

### Background

Captured from the creation title: "fallback envelope field and order resolution".

### Requirements

- [ ] R1. Parse and validate the optional `fallback` field on the image-gen job envelope: absent | `true` | ordered provider-name list; invalid shapes reject with an explicit error before any provider call.
- [ ] R2. `resolveFallbackOrder`: absent → `[requested]` (strict, unchanged behavior); `true` → requested first, then `AUTO_ORDER` minus `NEVER_AUTO` minus requested; list → validate every name against the provider registry.
- [ ] R3. Selection-time strictness is unchanged: an unknown or unconfigured requested provider still throws naming the provider and required env (feature scenario "Explicit fallback list is honored in order" and "Explicit unknown or unconfigured provider still throws at selection").

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
