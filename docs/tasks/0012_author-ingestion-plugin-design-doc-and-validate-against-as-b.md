---
template: standard
schema_version: 1
name: "Author ingestion plugin design doc and validate against as-built platform"
description: ""
status: done
type: task
profile: standard
feature_id: C1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0010", "0011"]
created_at: "2026-07-30T21:57:00.272Z"
updated_at: "2026-07-30T22:49:55.377Z"
---

## 0012. Author ingestion plugin design doc and validate against as-built platform

### Background



### Requirements
- R1: The design doc is authored at a decided location (docs/ vs `plugins/kk` authoring guide) and covers the generic plugin-instance contract plus ingestion-specific sections.
- R2: An FS-source pattern and an API-source pattern are each documented end-to-end: config declaration → invoke integration → Doc[] emission → failure paths.
- R3: The generic vs ingestion-specific split is explicit so D3 (generator design) cites the generic half instead of re-deriving it.
- R4: The doc is validated against registry, kindContract, and runInvoke as built; contradictions are resolved or recorded as proposed ADR entries.
- R5: If any surface shape changes (CLI flags, config keys, env vars, schemas), `docs/04_DESIGN.md` is updated in the same commit (constitution T3).
### Acceptance Criteria
```gherkin
Feature: Ingestion plugin design doc

  Scenario: Generic contract is reusable by other kinds
    Given the generic vs ingestion-specific split
    When D3 starts
    Then it can reference the generic sections without modification

  Scenario: Design is validated against the platform as built
    Given the decisions from tasks 0010 and 0011
    When the design doc is authored
    Then an FS source and an API source each have a complete config-to-Docs walkthrough
    And no statement contradicts B1/B2 behavior without a proposed ADR entry
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
- Design Doc Location: `docs/design/ingestion-plugin-specification.md`.
- Content: Section 1 defines generic plugin authoring contract (reusable by D3); Section 2 defines Ingestion-specific contract; Section 3 records platform verification against `kk-core` and `runInvoke`.
- Surface Index: Added design specifications index table to `docs/04_DESIGN.md` §6.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
- `docs/design/ingestion-plugin-specification.md:1`: Authored the Ingestion Plugin Specification & Generic Plugin Authoring Contract doc.
- `docs/04_DESIGN.md:116`: Added Design specifications index table referencing the new specification.
- `docs/tasks/0012_author-ingestion-plugin-design-doc-and-validate-against-as-b.md:18`: Completed task.

- Authored the specification doc covering generic plugin authoring contract (Section 1) and ingestion-specific contract (Section 2).
- Validated against as-built platform APIs (`discoverPlugins`, `kindContract`, `DocSchema`, `runInvoke`); confirmed zero platform contradictions.
- Updated `docs/04_DESIGN.md` in the same commit per constitution T3 rule.
### Testing
- Verified specification document against as-built code in `@gobing-ai/kk-core` and `@gobing-ai/knowledge-kit`.
- Command run: `bun run lint && bun run test` -> PASS.
- Numeric Coverage: N/A (specification task).
- Verdict: PASS.
### Review
| Priority | Category | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | Architecture | Verified Ingestion Plugin specification document against platform contracts | Approved |

- Functional Traceability: R1-R5 MET.
- Verdict: PASS.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-30T22:49:25.580Z todo → wip (system)
- 2026-07-30T22:49:52.393Z wip → testing (system)
- 2026-07-30T22:49:55.377Z testing → done (system)
