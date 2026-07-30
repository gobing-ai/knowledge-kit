---
template: standard
schema_version: 1
name: "Harden karakeep-local failure semantics"
description: ""
status: todo
type: task
profile: standard
feature_id: C2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0014"]
created_at: "2026-07-30T23:41:03.323Z"
updated_at: "2026-07-30T23:56:25.329Z"
---

## 0015. Harden karakeep-local failure semantics

### Background



### Requirements
- R1. Empty source folder → the plugin writes `[]` to `--out` and exits 0 (spec §2.4).
- R2. A corrupt/unparsable entry → warning to stderr, item skipped, valid items still emitted, exit 0.
- R3. Missing/unreadable source → non-zero exit; the error names the source path.
- R4. Each failure mode has an automated test (unit or invoke-contract level).
### Acceptance Criteria
```gherkin
Feature: Karakeep-local

  Scenario: Empty source yields empty Doc list with exit 0
    Given an empty source folder
    When the plugin runs
    Then it writes [] and exits 0

  Scenario: Unparsable items are skipped with a warning
    Given a fixture folder with one corrupt entry among valid ones
    When the plugin runs
    Then valid items are emitted, a warning goes to stderr, and exit is 0

  Scenario: Unreadable source fails loud
    Given a missing source folder
    When the plugin runs via knowledge-kit invoke
    Then the exit code is non-zero and the error names the source path
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
