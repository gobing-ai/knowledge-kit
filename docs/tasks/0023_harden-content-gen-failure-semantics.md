---
template: standard
schema_version: 1
name: "Harden content-gen failure semantics"
description: ""
status: todo
type: task
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0022"]
created_at: "2026-07-30T23:48:00.337Z"
updated_at: "2026-07-30T23:56:27.759Z"
---

## 0023. Harden content-gen failure semantics

### Background



### Requirements
- R1. A failing stand-in stage → non-zero exit with the error on stderr.
- R2. Empty DocList input → behavior matching the generator spec failure contract (exit code + output).
- R3. Stand-in output that violates the mapping is surfaced as an error, never silently written.
- R4. Each failure mode has an automated test.
### Acceptance Criteria
```gherkin
Feature: Wire existing generator skill to contract

  Scenario: Engine failure fails loud
    Given a stand-in stage fails for an input
    When the plugin runs
    Then it exits non-zero and the error reaches stderr

  Scenario: Empty input follows the generator failure contract
    Given an empty DocList input file
    When the plugin runs
    Then its exit code and output match the generator spec failure semantics
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
