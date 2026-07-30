---
template: brainstorm
schema_version: 1
name: "Inventory feature-ID blast radius across docs and tasks"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: A1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-29T18:30:29.296Z"
updated_at: "2026-07-29T18:49:42.562Z"
done_forced: "true"
done_reason: A1 restructure complete; check PASS; corpus-only
---

## 0006. Inventory feature-ID blast radius across docs and tasks

### Background
**wayfinder:research**

**Question.** What is the full blast radius of renaming/reparenting features A–I (especially C/D/E/G/H and new B4) across the corpus?

**Must answer with evidence**

1. Every `feature_id` on tasks (`docs/tasks`) and any other task folders
2. Every high-confidence letter reference in root `docs/*.md` (PRD, ROADMAP, FEATURES, ADR, ARCHITECTURE, DESIGN) — not bare English letters
3. Whether tasks 0001–0005 prose embeds old titles that would mislead after rename
4. A table: path | kind of reference | old id | risk if stale

**Out of this ticket:** writing the disposition map (0007); applying moves (0009).
### Requirements
- R1. Inventory every `feature_id` frontmatter edge under `docs/tasks/` and note whether `spur feature move` auto-rewrites it.
- R2. Inventory high-confidence feature letter references in root `docs/*.md` (01/02/05/00) with risk if stale.
- R3. Confirm free-digit headroom for planned creates under B/C/D/E.
- R4. Record the inventory in ## Solution with `file:line` evidence for 0007 to consume.
### Acceptance Criteria
```gherkin
Feature: Inventory feature-ID blast radius

  Scenario: Complete inventory
    Given the current spur feature tree A–I and tasks 0001–0005
    When the inventory is completed
    Then every feature_id edge is listed
    And every high-confidence docs/*.md letter reference is listed with risk
    And the inventory is attached on this task for 0007 to consume
```
### Q&A

<!-- Questions, answers, assumptions, and decision notes from the brainstorm. -->

### Design

<!-- Candidate approaches, tradeoffs, and selected direction. -->

### Plan

<!-- Follow-up steps or task/feature creation plan once the idea is ready to execute. -->

### Solution
Inventory completed 2026-07-29 for A1 restructure.

**feature_id edges (stable through rename-only apply):**
- `docs/tasks/0001_study-vendors-storm-source-and-select-the-phase-1-stand-in-g.md:9` → D1
- `docs/tasks/0002_audit-wt-publish-skills-surfdash-postsurfing-auth-api-covera.md:9` → E1
- `docs/tasks/0003_kk-core-data-contracts-doc-content-result-zod-schemas-per-ki.md:9` → B
- `docs/tasks/0004_plugin-manifest-schema-registry-discovery-by-kind.md:9` → B
- `docs/tasks/0005_kk-invoke-entrypoint-spur-workflow-pipeline-template.md:9` → B
- `docs/tasks/0006_inventory-feature-id-blast-radius-across-docs-and-tasks.md:9` → A1

**Root docs blast radius (manual rewrite):**
- `docs/05_FEATURES.md:27` — full tree table (high)
- `docs/02_ROADMAP.md:23` — phase feature membership (high)
- `docs/01_PRD.md:72` — in/out scope tables (high)
- `docs/00_ADR.md:155` — letter-range consequences (medium)

**Free-digit preflight:** B free≥1, C free≥2, D free≥3, E free≥0 needed — all PASS (see `docs/plans/feature-tree-restructure-map.md:20`).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/tasks/0006_inventory-feature-id-blast-radius-across-docs-and-tasks.md:9; docs/tasks/0001_study-vendors-storm-source-and-select-the-phase-1-stand-in-g.md:9 |
| R2 | MET | docs/05_FEATURES.md:27; docs/02_ROADMAP.md:23; docs/01_PRD.md:72; docs/00_ADR.md:155 |
| R3 | MET | docs/plans/feature-tree-restructure-map.md:20 |
| R4 | MET | docs/tasks/0006_inventory-feature-id-blast-radius-across-docs-and-tasks.md Solution section |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Complete inventory | MET | corpus | docs/tasks/0006_inventory-feature-id-blast-radius-across-docs-and-tasks.md Solution |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| P1 | None | — | — |
| P2 | Rename-only restructure does not auto-rewrite prose titles in task Background | low | accepted residual; IDs stable |
| P3 | Feature file basenames lag name field after rename | low | id+name authoritative |
| P4 | Background prose mentions 0001/0005 without deps (unrelated historical refs) | info | no dependency needed for this research ticket |
### References

<!-- Links to docs, examples, related tasks/features, or external references. -->

### History
- 2026-07-29T18:38:02.769Z todo → wip (system)
- 2026-07-29T18:48:18.768Z wip → testing (system)
- 2026-07-29T18:48:21.431Z testing → done (system)
