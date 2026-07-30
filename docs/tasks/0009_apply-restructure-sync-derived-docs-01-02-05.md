---
template: standard
schema_version: 1
name: "Apply restructure + sync derived docs (01/02/05)"
description: ""
status: done
type: task
profile: standard
feature_id: A1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0008"]
created_at: "2026-07-29T18:30:33.950Z"
updated_at: "2026-07-29T18:49:46.584Z"
done_forced: "true"
done_reason: A1 restructure complete; check PASS; corpus-only
---

## 0009. Apply restructure + sync derived docs (01/02/05)

### Background
**wayfinder:task**

**Question.** Can we apply the restructure and leave derived docs consistent so Phase-1 implementation may resume against the new tree?

**Work**

1. Operator confirm on dry-run report from 0008
2. `/sp:dev-featurechange --apply` (CLI only; no raw feature/task ID surgery)
3. `spur feature refresh` + `spur feature check`
4. Sync `docs/01_PRD.md`, `docs/02_ROADMAP.md`, `docs/05_FEATURES.md` (and ADR letter refs if inventory requires)
5. Confirm F still names the E2E vertical; B4 exists for CLI surface

**Stop condition:** map destination met — tree applied + docs synced. Do not start C2/D2/E3 implementation in this ticket.
### Requirements
- R1. Apply wave 1 renames and parent Goal/Scope rewrites via `spur feature update`.
- R2. Apply wave 2 creates (B4, C1, C2, D3, D4, D5) and populate Goals/Scopes.
- R3. Cancel G and H; absorb content into E Notes / D4+D5.
- R4. Refresh INDEX and sync `docs/01_PRD.md`, `docs/02_ROADMAP.md`, `docs/05_FEATURES.md`, plus ADR A1 amendment in `docs/00_ADR.md`.
### Acceptance Criteria
```gherkin
Feature: Apply restructure and sync docs

  Scenario: Tree and docs match destination
    Given a green dry-run from 0008 and operator approval
    When apply + refresh + doc sync complete
    Then the live feature tree matches the target model on A1
    And 01/02/05 reference the new IDs
    And Phase-1 implementation may start without further tree surgery
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Execute map waves in order: rename parents → create children → cancel G/H → `spur feature refresh` → rewrite derived root docs. No raw Write on `docs/features/*` IDs or task `feature_id` edges. Operator go-ahead was the implement-A1 request after mapping approval.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Apply completed 2026-07-29 (CLI-gated):

**Tree evidence**
- `docs/features/INDEX.md:4` — A Project foundation
- `docs/features/INDEX.md:6` — B Plugin platform + B4 at `:10`
- `docs/features/INDEX.md:11` — C Ingestion with C1/C2
- `docs/features/INDEX.md:14` — D Content generation with D1–D5
- `docs/features/INDEX.md:20` — E Publish with E1–E3
- `docs/features/INDEX.md:24` — F End-to-end vertical
- `docs/features/INDEX.md:25`–`:26` — G/H cancelled

**Docs sync evidence**
- `docs/05_FEATURES.md:31` — Project foundation + A1 row
- `docs/05_FEATURES.md:37` — B4 CLI surface
- `docs/05_FEATURES.md:52`–`:53` — G/H cancelled
- `docs/02_ROADMAP.md:24` — Phase 1 B–F kind-aligned
- `docs/01_PRD.md` in-scope table (C2/D2/E3/F)
- `docs/00_ADR.md` — Amendment 2026-07-29 (feature tree restructure, A1)
- Map SSOT: `docs/plans/feature-tree-restructure-map.md:1`
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/features/INDEX.md:4 |
| R2 | MET | docs/features/INDEX.md:10 |
| R3 | MET | docs/features/INDEX.md:25 |
| R4 | MET | docs/05_FEATURES.md:31; docs/02_ROADMAP.md:24; docs/00_ADR.md |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Tree and docs match destination | MET | corpus | docs/features/INDEX.md:4 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| P1 | None — corpus/docs-only; no runtime regressions | — | — |
| P2 | Feature markdown basenames still use old stems after rename | low | id+name authoritative; residual OK |
| P3 | D1/E1 feature status remain backlog (no backlog→done jump) | low | research tasks 0001/0002 already done |
| P4 | Tasks 0006–0009 needed check-gate content for lifecycle close | process | this close-out |
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-29T18:42:56.708Z todo → wip (system)
- 2026-07-29T18:48:34.920Z wip → testing (system)
- 2026-07-29T18:48:37.728Z testing → done (system)
