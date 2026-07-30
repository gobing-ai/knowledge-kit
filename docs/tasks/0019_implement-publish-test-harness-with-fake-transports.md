---
template: standard
schema_version: 1
name: "Implement publish test harness with fake transports"
description: ""
status: todo
type: task
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0018"]
created_at: "2026-07-30T23:42:20.624Z"
updated_at: "2026-07-30T23:56:26.341Z"
---

## 0019. Implement publish test harness with fake transports

### Background



### Requirements
- R1. `packages/publish-harness` workspace created (`@gobing-ai/publish-harness`), wired into the Bun workspaces build/test graph.
- R2. Fake FileCli transport + fixtures capture publish invocations with no external effects.
- R3. A proof test exercises the fake transport end-to-end offline and passes under `bun run test`.
- R4. Harness API is documented for E3 (TSDoc on exports, per the tsdoc-exports rule).
### Acceptance Criteria
```gherkin
Feature: Publish design and test harness

  Scenario: Harness enables offline unit tests for publish plugins
    Given the publish-harness package
    When a proof test exercises a fake FileCli transport
    Then the test passes with no publish side effects outside fixtures
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
