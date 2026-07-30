---
template: standard
schema_version: 1
name: "Author generator plugin specification and validate against platform"
description: ""
status: todo
type: task
profile: standard
feature_id: D3
parent_wbs: null
priority: P2
tags: []
dependencies: ["0016"]
created_at: "2026-07-30T23:41:42.626Z"
updated_at: "2026-07-30T23:41:43.261Z"
---

## 0017. Author generator plugin specification and validate against platform

### Background



### Requirements
- R1: `docs/design/generator-plugin-specification.md` authored; it cites ingestion spec §1 for manifest/invocation/secrets/exit-code rules instead of re-deriving them.
- R2: The spec is validated against as-built `kindContract('generator')` and `runInvoke`; every contradiction is resolved or recorded as a proposed ADR entry.
- R3: `docs/04_DESIGN.md` §6 index row added in the same commit (constitution T3).
### Acceptance Criteria
```gherkin
Feature: Generator plugin design

  Scenario: Design cites the generic contract
    Given the generic plugin-instance contract (ingestion spec section 1)
    When the generator spec is authored
    Then it cites section 1 for manifest, invocation, secrets, and exit-code rules instead of re-deriving them

  Scenario: Design is validated against the platform as built
    Given kindContract('generator') and runInvoke as implemented
    When the design is reviewed against them
    Then no requirement contradicts the platform without an ADR entry
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
