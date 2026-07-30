---
template: standard
schema_version: 1
name: "Add plugins list subcommand"
description: ""
status: todo
type: task
profile: standard
feature_id: B4
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-30T23:42:55.633Z"
updated_at: "2026-07-30T23:42:56.010Z"
---

## 0020. Add plugins list subcommand

### Background



### Requirements
- R1: `knowledge-kit plugins list` prints discovered plugins grouped by kind via `logger.out`.
- R2: `--kind <kind>` narrows output to a single plugin kind.
- R3: `--json` emits machine-readable registry output.
- R4: `--plugins-root` resolves the same registry as `invoke --plugins-root`; tests go through the `createProgram()` factory (no parse at module scope).
### Acceptance Criteria
```gherkin
Feature: CLI surface

  Scenario: List shows discovered plugins
    Given a plugins root with plugins of multiple kinds
    When knowledge-kit plugins list runs
    Then plugins print grouped by kind and --json emits machine-readable output

  Scenario: Plugins root is consistent with invoke
    Given a non-default plugins directory
    When plugins list and doctor run with --plugins-root
    Then they resolve the same registry as invoke with --plugins-root

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
