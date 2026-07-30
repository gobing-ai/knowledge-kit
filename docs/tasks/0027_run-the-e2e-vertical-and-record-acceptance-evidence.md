---
template: standard
schema_version: 1
name: "Run the E2E vertical and record acceptance evidence"
description: ""
status: todo
type: task
profile: standard
feature_id: B5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0026"]
created_at: "2026-07-30T23:48:59.944Z"
updated_at: "2026-07-30T23:56:28.866Z"
---

## 0027. Run the E2E vertical and record acceptance evidence

### Background



### Requirements
- R1. One `spur workflow run` takes a fixture Karakeep item through content-gen to a published Surfdash post; result.json shows ok: true.
- R2. Fail-loud chaining is demonstrated: an induced step failure aborts the workflow with a non-zero exit and names the failing step.
- R3. Evidence is recorded in the task Testing section (commands, outputs) and the verdict artifact.
### Acceptance Criteria
```gherkin
Feature: End-to-end pipeline acceptance

  Scenario: R1 — Vertical run publishes Surfdash from Karakeep-local
    Given C2 Karakeep-local, D2 generator stand-in, and E3 Surfdash plugins are installable
    And the B3 ingest-generate-publish workflow template is configured for those plugins
    When the workflow runs end to end
    Then a Karakeep-local item becomes a published Surfdash post
    And each step fails loud on contract or process errors
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
