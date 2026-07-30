---
template: standard
schema_version: 1
name: "Define Doc mapping and failure semantics conventions"
description: ""
status: done
type: task
profile: standard
feature_id: C1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-30T21:57:00.127Z"
updated_at: "2026-07-30T22:49:11.659Z"
---

## 0011. Define Doc mapping and failure semantics conventions

### Background



### Requirements
- R1: A Doc `id` derivation rule guarantees stability: re-running an ingestion plugin over unchanged input yields identical ids (downstream dedup depends on this; C2 defers incremental-sync state).
- R2: Conventions define `sourceUri`, `mediaType`, `title` usage and what promotes to a Doc field vs stays in `metadata`.
- R3: Empty-output semantics are decided (`DocListSchema` accepts `[]`): explicit success-or-failure ruling plus the exit-code contract.
- R4: Partial item failure policy is decided (skip-with-warning vs fail-fast) together with the diagnostics channel (stderr vs sidecar file).
- R5: Conventions are validated against `DocSchema`/`DocListSchema` as built; any needed schema change is escalated as an ADR-level decision, not made here.
### Acceptance Criteria
```gherkin
Feature: Doc mapping and failure semantics conventions

  Scenario: Doc mapping conventions are specified
    Given the id derivation rule and field conventions
    When an ingestion plugin runs twice over unchanged input
    Then both runs produce identical Doc ids

  Scenario: Failure semantics are specified
    Given empty output, partial item failure, and unreadable source
    When the conventions are applied
    Then each case has a defined exit code and output-file expectation
    And no convention requires a schema change, or the change is escalated to ADR level
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
- Doc ID Derivation: Deterministic string derived from canonical relative file path (FS) or resource URI/ID (API).
- Field Promotion: Top-level fields reserved for `title`, `sourceUri`, `mediaType`. All vendor/source-specific key-values stored in `metadata`.
- Empty-Output Contract: `DocListSchema` permits `[]` output with exit code 0.
- Partial Failure & Diagnostics: Individual unparseable files log warnings to `stderr` and skip; unreadable source root exits non-zero.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
- `packages/kk-core/src/schemas.ts:4`: Established conventions for Doc ID stability, field mapping vs metadata, empty-output semantics, and partial failure policies against `DocSchema` / `DocListSchema`.
- `docs/tasks/0011_define-doc-mapping-and-failure-semantics-conventions.md:18`: Documented mapping decisions and failure semantics.

- Doc ID Stability: `id` is derived deterministically from the canonical source path/URI, guaranteeing identical IDs across re-runs.
- Field Conventions: `title`, `sourceUri`, and `mediaType` are promoted to top-level `Doc` fields; all extra source-specific properties live in `metadata`.
- Empty Output: `DocListSchema` accepts `[]`. Ingestion of zero items emits `[]` with exit code `0`.
- Failure Semantics: Partial item failures log warnings to `stderr` and skip the item; fatal errors (unreadable source directory/auth failure) exit non-zero.
- Schema Alignment: Verified against `DocSchema`/`DocListSchema` in `@gobing-ai/kk-core`. No schema edits needed.
### Testing
- Verified conventions against `DocSchema` and `DocListSchema` tests in `packages/kk-core/tests/schemas.test.ts`.
- Command run: `bun run lint && bun run test` -> PASS.
- Numeric Coverage: N/A (specification task).
- Verdict: PASS.
### Review
| Priority | Category | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | Architecture | Verified Doc mapping and failure semantics against DocSchema/DocListSchema | Approved |

- Functional Traceability: R1-R5 MET.
- Verdict: PASS.
### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
- 2026-07-30T22:48:34.712Z todo → wip (system)
- 2026-07-30T22:49:05.630Z wip → testing (system)
- 2026-07-30T22:49:11.659Z testing → done (system)
