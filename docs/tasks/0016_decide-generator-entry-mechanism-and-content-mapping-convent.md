---
template: standard
schema_version: 1
name: "Decide generator entry mechanism and Content mapping conventions"
description: ""
status: todo
type: task
profile: standard
feature_id: D3
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-30T23:41:42.492Z"
updated_at: "2026-07-30T23:41:42.887Z"
---

## 0016. Decide generator entry mechanism and Content mapping conventions

### Background



### Requirements
- R1: Skill-backed entry mechanism decided (executable wrapper CLI vs generated shim vs invoke change — the last escalates to an ADR note), with rationale and argv/env contract for the plugin author.
- R2: Doc[]→Content field conventions defined against ContentSchema as built: `format` (default markdown), `outline`, `references`, `metadata` usage; no schema changes.
- R3: Stand-in vs own-engine selection criteria recorded (D1 research as input; explicit conditions for switching to D4).
- R4: Generator failure semantics defined — empty DocList input, engine failure, invalid output — each with an explicit exit-code and output-file contract (fail-loud per ADR-006 + C1 §1.4).
### Acceptance Criteria
```gherkin
Feature: Generator plugin design

  Scenario: Content mapping conventions are specified
    Given the Content schema in kk-core
    When the design defines Doc[]-to-Content field conventions
    Then format, outline, references, and metadata usage are defined without schema changes

  Scenario: Skill-backed entry mechanism is decided
    Given runInvoke spawns executable entries with --in/--out
    When the design names how an agent-skill generator runs under kk invoke
    Then a plugin author can implement the entry without changes to runInvoke

  Scenario: Stand-in versus own-engine criteria are specified
    Given the D1 research (stand-in = wt:technical-content-creation stages 0-3)
    When the design records selection criteria
    Then the conditions for switching from stand-in to own engine (D4) are explicit

  Scenario: Generator failure semantics are specified
    Given the fail-loud mandate (ADR-006) and C1 generic contract section 1.4
    When the design covers empty DocList input, engine failure, and invalid output
    Then each case has an explicit exit-code and output-file contract
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
