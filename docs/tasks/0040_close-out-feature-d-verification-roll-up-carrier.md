---
schema_version: 1
name: "Close out feature D verification (roll-up carrier)"
status: todo
template: feature-impl
created_at: 2026-08-12T02:03:44.028Z
updated_at: "2026-08-12T02:04:15.655Z"
feature_id: D
---

## 0040. Close out feature D verification (roll-up carrier)

### Background

<!-- Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent. -->

### Requirements
- R1: Carry D's uncovered composition scenario verbatim ("Generator kind composes into the platform") as this task's AC so DD-09 coverage is satisfied for feature D.
- R2: Advance D `verifying → done` via `spur feature sync D --force` with the L4 guard passing — no bypass, no guard weakening.
### Acceptance Criteria
```gherkin
Feature: Close out feature D verification

  @core
  Scenario: Generator kind composes into the platform
    Given a generator plugin discovered by the registry
    When knowledge-kit invoke runs it with a DocList or Brief input
    Then its Content output feeds the publish step of a spur workflow

  Scenario: Roll-up closes the parent
    Given feature D at verifying with all linked tasks terminal
    When the roll-up carrier is verified
    Then spur feature check D reports zero L4 errors and D advances to done
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
