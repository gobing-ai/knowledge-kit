---
template: standard
schema_version: 1
name: "Survey Karakeep mirror layout and implement karakeep-local plugin"
description: ""
status: todo
type: task
profile: standard
feature_id: C2
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-30T23:41:03.188Z"
updated_at: "2026-07-30T23:41:03.580Z"
---

## 0014. Survey Karakeep mirror layout and implement karakeep-local plugin

### Background



### Requirements
- R1: The on-disk layout of the rclone-synced Karakeep mirror is surveyed and pinned as fixtures under the plugin's tests; the layout is documented in the task Solution.
- R2: Plugin directory `plugins/karakeep-local` with a valid `plugin.json` (kind=ingestion, entry) is discoverable by the registry.
- R3: The entry reads the `--in` folder, parses Karakeep entries, and maps each valid item to a Doc per spec §2.3 — deterministic id from the canonical source path; `title`/`sourceUri`/`mediaType` promoted; vendor extras in `metadata`.
- R4: Output written to `--out` satisfies DocListSchema, verified end-to-end via `knowledge-kit invoke` against the fixtures.
### Acceptance Criteria
```gherkin
Feature: Karakeep-local

  Scenario: Plugin is discoverable and invocable
    Given plugins/karakeep-local with a valid plugin.json (kind=ingestion)
    When the registry discovers it and knowledge-kit invoke runs it
    Then the entry executes and writes an output file

  Scenario: Folder items become contract-valid Docs
    Given a fixture folder of Karakeep export entries
    When the plugin runs via knowledge-kit invoke
    Then the output parses against DocListSchema with one Doc per valid item

  Scenario: Doc ids are stable across re-runs
    Given an unchanged fixture folder
    When the plugin runs twice
    Then both runs emit identical Doc ids
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
