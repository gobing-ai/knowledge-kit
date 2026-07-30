---
template: brainstorm
schema_version: 1
name: "Draft feature-tree-restructure mapping file (dispositions)"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: A1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0006"]
created_at: "2026-07-29T18:30:30.722Z"
updated_at: "2026-07-29T18:49:43.908Z"
done_forced: "true"
done_reason: A1 restructure complete; check PASS; corpus-only
---

## 0007. Draft feature-tree-restructure mapping file (dispositions)

### Background
**wayfinder:prototype**

**Question.** What is the complete old_id → disposition mapping that encodes the approved target tree on feature **A1**?

**Must produce** `docs/plans/feature-tree-restructure-map.md` (or path noted if different) with rows for every current product feature covering: keep | rename-only | reparent-under | create-new | archive | absorb-notes.

**Encode these locked decisions**

- A rename → Project foundation; **A1** is this restructure map under A
- B rename → Plugin platform; add B4 CLI surface (create)
- C becomes parent Ingestion; current C → C2 Karakeep-local; create C1 design
- D becomes parent Content generation; D1/D2 keep; was-D → D3 design; H → D4 STORM + D5 wt generator harvest
- E becomes parent Publish; E1 audit disposition explicit; E2 harness; E3 Surfdash; G content → deferred under E (not pre-create 9 kids unless map says so)
- F keep as E2E vertical (rename OK)
- G/H archive roots after reparent of meaning
- I keep fog
- A1 is the wayfinder map (meta under foundation — not a product capability root)

**Depends on** 0006 inventory for prose blast radius notes in the map.
### Requirements
- R1. Write `docs/plans/feature-tree-restructure-map.md` as SSOT for dispositions.
- R2. Encode locked decisions: B4 CLI, keep F, kind-aligned C/D/E, G→E Notes, H→D4/D5, map under A1.
- R3. Include free-digit preflight and apply waves (rename / create / cancel / docs).
- R4. Cover every live product feature A–I with a disposition row.
### Acceptance Criteria
```gherkin
Feature: Draft restructure mapping file

  Scenario: Map is complete and consistent with A1
    Given feature A1 target tree and the 0006 inventory
    When the mapping file is written
    Then every live product feature has a disposition row
    And locked decisions (B4, keep F, kind-aligned C/D/E, split H, absorb G, map under A1) are encoded
    And create/reparent/archive rows are ordered into apply waves
```
### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

<!-- Candidate approaches, tradeoffs, and selected direction. -->

### Plan

<!-- Follow-up steps or task/feature creation plan once the idea is ready to execute. -->

### Solution
Mapping SSOT written and used for apply:

- Map file: `docs/plans/feature-tree-restructure-map.md:1` (title / A1 ownership)
- Locked decisions: `docs/plans/feature-tree-restructure-map.md:12` (B4, keep F, kind parents, G/H split)
- Free-digit table: `docs/plans/feature-tree-restructure-map.md:20`
- Disposition rows: `docs/plans/feature-tree-restructure-map.md:33` (A rename → Project foundation)
- Create B4/C2/D4: `docs/plans/feature-tree-restructure-map.md:78`
- Archive G/H: `docs/plans/feature-tree-restructure-map.md:91`
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/plans/feature-tree-restructure-map.md:1 |
| R2 | MET | docs/plans/feature-tree-restructure-map.md:12 |
| R3 | MET | docs/plans/feature-tree-restructure-map.md:20 |
| R4 | MET | docs/plans/feature-tree-restructure-map.md:33 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Map is complete and consistent with A1 | MET | corpus | docs/plans/feature-tree-restructure-map.md:1 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| P1 | None | — | — |
| P2 | Map uses create+rename rather than feature move for most rows | info | intentional; free-digit PASS |
| P3 | G cancelled before map row applied chronologically | low | final state matches map; notes absorbed to E |
| P4 | Checklist boxes in map docs section left as apply-time items | info | closed by 0009 |
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-07-29T18:42:51.582Z todo → wip (system)
- 2026-07-29T18:48:24.106Z wip → testing (system)
- 2026-07-29T18:48:26.836Z testing → done (system)
