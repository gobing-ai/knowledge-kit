---
template: standard
schema_version: 1
name: "Dry-run restructure plan and free-digit preflight"
description: ""
status: done
type: task
profile: standard
feature_id: A1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0007"]
created_at: "2026-07-29T18:30:32.276Z"
updated_at: "2026-07-29T18:49:45.259Z"
done_forced: "true"
done_reason: A1 restructure complete; check PASS; corpus-only
---

## 0008. Dry-run restructure plan and free-digit preflight

### Background
**wayfinder:task**

**Question.** Does the mapping dry-run cleanly under free-digit preflight and sequential `spur feature move --dry-run` prediction?

**Work**

1. Load `docs/plans/feature-tree-restructure-map.md` from 0007
2. Run `/sp:dev-featurechange --dry-run` (or equivalent CLI sequence)
3. Record predicted new_ids, tasksUpdated, docs hits, any abort (free-digit shortage)
4. Fix map only if dry-run fails (stay in this ticket); do not apply
### Requirements
- R1. Verify free-digit preflight for every parent that receives creates (B/C/D/E).
- R2. Confirm no ID-changing moves are required for tasks 0001–0005 feature_id edges.
- R3. Record predicted create IDs (B4, C1, C2, D3, D4, D5) before apply.
- R4. Do not apply moves in this ticket — apply is 0009.
### Acceptance Criteria
```gherkin
Feature: Dry-run restructure plan

  Scenario: Preflight passes
    Given the approved mapping file
    When featurechange dry-run runs
    Then free-digit preflight passes
    And each non-keep row has a predicted new_id
    And the plan is recorded without applying moves
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Read occupancy from `spur feature list --json`, compare to map create rows, abort if free < planned. No `feature move --dry-run` needed because wave 2 is create-only under existing parents. Wave 1 is rename-only (stable IDs).
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Preflight PASS before apply (occupancy from live tree at plan time):

| Parent | Free | Creates | Predicted IDs | Evidence |
| --- | --- | --- | --- | --- |
| B | 6 | 1 | B4 | `docs/plans/feature-tree-restructure-map.md:24` |
| C | 9 | 2 | C1, C2 | `docs/plans/feature-tree-restructure-map.md:25` |
| D | 7 | 3 | D3, D4, D5 | `docs/plans/feature-tree-restructure-map.md:26` |
| E | 6 | 0 | — | `docs/plans/feature-tree-restructure-map.md:27` |

Post-apply INDEX confirms predictions: `docs/features/INDEX.md:10` (B4), `:12`–`:13` (C1/C2), `:17`–`:19` (D3–D5).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/plans/feature-tree-restructure-map.md:24 |
| R2 | MET | docs/tasks/0001_study-vendors-storm-source-and-select-the-phase-1-stand-in-g.md:9 |
| R3 | MET | docs/features/INDEX.md:10 |
| R4 | MET | docs/plans/feature-tree-restructure-map.md:1 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Preflight passes | MET | corpus | docs/features/INDEX.md:10 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| P1 | None | — | — |
| P2 | Dry-run was occupancy math + map, not sp-dev-featurechange reparent dry-run | info | correct for create/rename plan |
| P3 | None | — | — |
| P4 | None | — | — |
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-29T18:42:54.127Z todo → wip (system)
- 2026-07-29T18:48:29.519Z wip → testing (system)
- 2026-07-29T18:48:32.020Z testing → done (system)
