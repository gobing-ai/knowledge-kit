---
template: standard
schema_version: 1
name: "Implement content-gen stand-in adapter plugin"
description: ""
status: todo
type: task
profile: standard
feature_id: D2
parent_wbs: null
priority: P2
tags: []
dependencies: ["0017"]
created_at: "2026-07-30T23:48:00.205Z"
updated_at: "2026-07-30T23:56:27.487Z"
---

## 0022. Implement content-gen stand-in adapter plugin

### Background



### Requirements
- R1. `plugins/content-gen` with a valid `plugin.json` (kind=generator, entry per the generator spec mechanism from 0016/0017).
- R2. The adapter maps invoke file IO (docs.json → content.json) to stand-in stages 0–3; output satisfies ContentSchema.
- R3. No modifications to wt-owned skill files — the adapter is the only new code at the boundary.
- R4. A contract test runs `knowledge-kit invoke` over fixtures and produces ContentSchema-valid output (LLM stages mocked at the adapter boundary per the generator spec test strategy).
### Acceptance Criteria
```gherkin
Feature: Wire existing generator skill to contract

  Scenario: Plugin is discoverable and invocable
    Given plugins/content-gen with a valid plugin.json (kind=generator)
    When the registry discovers it and knowledge-kit invoke runs it
    Then the entry executes and writes an output file

  Scenario: Docs become contract-valid Content
    Given a docs.json fixture of valid Docs
    When the plugin runs via knowledge-kit invoke
    Then the output parses against ContentSchema

  Scenario: Stand-in internals are not modified
    Given the wt:technical-content-creation skill is owned by wt
    When the adapter delegates to its stages 0-3
    Then no files under the wt skill are changed
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
