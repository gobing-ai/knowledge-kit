---
template: standard
schema_version: 1
name: "Harden surfdash-pub failure modes"
description: ""
status: todo
type: task
profile: standard
feature_id: E3
parent_wbs: null
priority: P2
tags: []
dependencies: ["0024"]
created_at: "2026-07-30T23:48:35.444Z"
updated_at: "2026-07-30T23:56:28.291Z"
---

## 0025. Harden surfdash-pub failure modes

### Background



### Requirements
- R1. Transport failure → non-zero exit plus Result ok: false carrying the error.
- R2. postsurfing non-zero exit is mapped to a fail-loud Result — never swallowed (the wt always-exit-0 anti-pattern).
- R3. Malformed Content input is rejected by invoke's input validation before the entry runs (contract.input = ContentSchema); the plugin never sees invalid input.
- R4. Each failure mode has an automated test.
### Acceptance Criteria
```gherkin
Feature: Surfdash publisher tested

  Scenario: Transport failure produces a fail-loud Result
    Given the postsurfing transport fails
    When the plugin runs
    Then it exits non-zero and the Result carries ok false with the error
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
