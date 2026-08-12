---
schema_version: 1
name: "Grow kk plugin collection: intake plugins/kk capabilities as child features"
status: todo
template: feature-impl
created_at: 2026-08-12T01:44:12.763Z
updated_at: "2026-08-12T02:09:19.354Z"
feature_id: F
---

## 0038. Grow kk plugin collection: intake plugins/kk capabilities as child features

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- R1: Intake process defined — when a capability ships under `plugins/kk`, it is represented by feature F or a child feature of F (same change as the capability).
- R2: Collection discoverable — the feature tree (INDEX) and `05_FEATURES` list F and its children.
### Acceptance Criteria
```gherkin
Feature: Grow kk plugin collection

  Scenario: Capability lands as a child of F
    Given a capability added under plugins/kk (skill, slash command, or subagent)
    When the capability ships
    Then it is represented by feature F or a child feature of F

  Scenario: Collection is discoverable
    Given the kk plugin collection feature
    When an agent reads the feature tree
    Then INDEX and 05_FEATURES list F and its children
```

<!-- Open questions and their resolutions. Delete if none. -->

### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design

<!-- Decision record — WHAT/WHY. Chosen approach + 1-line reason, rejected alternatives, key signatures (not bodies), invariants. ≤2 illustrative snippets MAX. -->

### Plan

<!-- Ordered checklist or table of implementation steps (not prose). The how-to-execute order within this one task. -->

### Solution

<!-- Change map — HOW/WHERE. A `file:line` table of every touched site, one sentence each; ≤8-line snippets only for non-obvious logic. NO full-function dumps. (Filled at `wip`/`testing`.) -->

### Testing

<!-- Test results + a numeric coverage claim, or explicit `N/A`. (Filled at `testing`.) -->

### Review

<!-- P1–P4 findings table (Severity / File / Finding / Recommendation). (Filled at `done`.) -->

### History
