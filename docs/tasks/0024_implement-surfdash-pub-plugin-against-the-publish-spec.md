---
template: standard
schema_version: 1
name: "Implement surfdash-pub plugin against the publish spec"
description: ""
status: todo
type: task
profile: standard
feature_id: E3
parent_wbs: null
priority: P2
tags: []
dependencies: ["0018", "0019"]
created_at: "2026-07-30T23:48:35.305Z"
updated_at: "2026-07-30T23:48:36.069Z"
---

## 0024. Implement surfdash-pub plugin against the publish spec

### Background



### Requirements
- R1: `plugins/surfdash-pub` with a valid `plugin.json` (kind=publish).
- R2: Content→Surfing frontmatter mapping per the publish spec; postsurfing CLI invoked via the FileCli transport from 0018.
- R3: Unit tests use the publish-harness fake FileCli transport (0019) — no external effects; coverage aligns with the repo gate (line/function ≥ 90%).
- R4: Success path emits a ResultSchema-valid Result (ok: true, target: surfdash).
### Acceptance Criteria
```gherkin
Feature: Surfdash publisher tested

  Scenario: Plugin is discoverable and invocable
    Given plugins/surfdash-pub with a valid plugin.json (kind=publish)
    When the registry discovers it and knowledge-kit invoke runs it
    Then the entry executes and writes a Result output file

  Scenario: Content publishes to Surfing with a success Result
    Given a valid Content input file
    When the plugin runs against the postsurfing transport
    Then the output parses against ResultSchema with ok true and target surfdash

  Scenario: Frontmatter mapping follows the publish spec
    Given a Content with title, body, and metadata
    When the plugin maps it to Surfing frontmatter
    Then the mapping matches the publish spec conventions

  Scenario: Unit tests run offline via the harness
    Given the publish-harness fake FileCli transport
    When the plugin unit tests run
    Then they pass with no publish side effects outside fixtures
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
