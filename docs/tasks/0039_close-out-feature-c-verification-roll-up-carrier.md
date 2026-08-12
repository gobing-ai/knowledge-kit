---
schema_version: 1
name: "Close out feature C verification (roll-up carrier)"
status: todo
template: feature-impl
created_at: 2026-08-12T02:03:43.892Z
updated_at: "2026-08-12T02:04:07.409Z"
feature_id: C
---

## 0039. Close out feature C verification (roll-up carrier)

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- R1: Carry C's uncovered composition scenario verbatim ("Ingestion kind composes into the platform") as this task's AC so DD-09 coverage is satisfied for feature C.
- R2: Advance C `verifying → done` via `spur feature sync C --force` with the L4 guard passing — no bypass, no guard weakening.
### Acceptance Criteria
```gherkin
Feature: Close out feature C verification

  @core
  Scenario: Ingestion kind composes into the platform
    Given an ingestion plugin discovered by the registry
    When knowledge-kit invoke runs it
    Then its DocList output feeds the generator step of a spur workflow

  Scenario: Roll-up closes the parent
    Given feature C at verifying with all linked tasks terminal
    When the roll-up carrier is verified
    Then spur feature check C reports zero L4 errors and C advances to done
```
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
