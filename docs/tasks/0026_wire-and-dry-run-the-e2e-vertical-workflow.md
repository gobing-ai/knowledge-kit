---
template: standard
schema_version: 1
name: "Wire and dry-run the E2E vertical workflow"
description: ""
status: todo
type: task
profile: standard
feature_id: B5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0015", "0023", "0025"]
created_at: "2026-07-30T23:48:59.810Z"
updated_at: "2026-07-30T23:56:28.582Z"
---

## 0026. Wire and dry-run the E2E vertical workflow

### Background



### Requirements
- R1. Workflow vars in the vertical run are set to `karakeep-local` / `content-gen` / `surfdash-pub` with a real fixture source folder.
- R2. The workflow validates (`spur workflow validate`) and a staged dry-run confirms each step's IO contract chaining (docs.json → content.json → result.json).
- R3. The fixture Karakeep item and work dir live under a gitignored scratch path.
### Acceptance Criteria
```gherkin
Feature: End-to-end pipeline acceptance

  Scenario: R2 — Acceptance is platform composition, not a new plugin kind
    Given the platform composes plugins via spur workflow
    When the vertical is defined
    Then it is expressed as a workflow over B3 invoke + C2/D2/E3
    And no fourth plugin kind is introduced
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
