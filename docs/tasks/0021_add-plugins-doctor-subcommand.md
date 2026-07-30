---
template: standard
schema_version: 1
name: "Add plugins doctor subcommand"
description: ""
status: todo
type: task
profile: standard
feature_id: B4
parent_wbs: null
priority: P2
tags: []
dependencies: ["0020"]
created_at: "2026-07-30T23:42:55.764Z"
updated_at: "2026-07-30T23:42:56.395Z"
---

## 0021. Add plugins doctor subcommand

### Background



### Requirements
- R1: `knowledge-kit plugins doctor` validates every manifest under `--plugins-root` and surfaces each `DiscoveryDiagnostic` with path and reason.
- R2: Missing entry files are reported as diagnostics.
- R3: Exit code is non-zero when any diagnostic exists, zero when the tree is healthy; `--json` emits diagnostics machine-readably.
- R4: No new registry logic — diagnostics come from `discoverPlugins` as built.
### Acceptance Criteria
```gherkin
Feature: CLI surface

  Scenario: Doctor surfaces discovery diagnostics
    Given a plugins root with a malformed manifest and a duplicate name
    When knowledge-kit plugins doctor runs
    Then each diagnostic names the path and reason and the exit code is non-zero

  Scenario: Surface is documented in the same commit
    Given the new subcommands
    When the implementing commit lands
    Then docs/04_DESIGN.md section 1 documents them in that commit
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
