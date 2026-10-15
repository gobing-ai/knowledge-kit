---
schema_version: 1
name: Select evidence-backed ITC topics from the collection store
status: todo
template: feature-impl
created_at: 2026-10-15T21:59:21.902Z
updated_at: "2026-10-15T22:31:38.484Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 8

---

## 0299. Select evidence-backed ITC topics from the collection store

### Background

Current kk-itc has shipped authoring and fan-out but centralizes channel policy, duplicates browser routing and permits weak artifact evidence. This slice delivers: Add explicit collected-topic input and refresh using resolved kk-collect completion plus store extraction. Validate bounded candidate references; persist topic evidence and run-owned selections. Release on author-only/failure, retain uncertain effects and mark only confirmed live outcomes.

Implements feature G21 scenarios: R2 — Collected evidence can supply a selected topic; R3 — Empty or unavailable collections stop topic selection safely.

Owned surface: plugins/kk/workflows/kk-itc.yaml topic entry; apps/cli store/stage helpers; plugins/kk/commands/workflow-run.md input parsing; collected-topic tests.

Verified premises: apps/cli/src/commands/store.ts:1277; plugins/kk/workflows/kk-collect.yaml:1. Full contract: docs/design/kk-itc-refactor.md. Preserve existing Content → Result, direct entry execution and plugin-owned validation. No new service or live account is needed.

Rubric: E8 D1 L3 C1 R1 = 14; independent behavior/risk boundary with implementation and tests together. 

Ordering: no prerequisites within this batch. Shared workflow/stage surfaces are sequenced, not concurrently edited.

2026-10-15 operator feedback amendment: Collected topic intake runs before final workspace allocation. Keep preselection scratch under the parent run; validate the selected topic slug and copy pool/provenance into the config-derived topic workspace. Coordinate the node output contract with the DAG owner; direct topic/file modes still bypass collection.

### Requirements

- [ ] R1. Collected evidence can supply a selected topic; ranked candidates cite item IDs and source URLs and the selected candidate becomes the brief with a topic-scoped selection record.
- [ ] R2. Empty or unavailable collections stop topic selection safely; it reports no usable topic and writes no draft or publication and releases any selection owned by this run.

### Acceptance Criteria

```gherkin
Feature: Select evidence-backed ITC topics from the collection store

  Scenario: AC1 — Collected evidence can supply a selected topic (req: R1)
    Given explicit collected-topic mode with a nonempty store pool from kk-collect
    When topic discovery runs
    Then ranked candidates cite item IDs and source URLs and the selected candidate becomes the brief with a topic-scoped selection record

  Scenario: AC2 — Empty or unavailable collections stop topic selection safely (req: R2)
    Given collected-topic mode with an empty pool or a failed explicitly requested collection refresh
    When topic discovery runs
    Then it reports no usable topic and writes no draft or publication and releases any selection owned by this run
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Add explicit collected-topic input and refresh using resolved kk-collect completion plus store extraction. Validate bounded candidate references; persist topic evidence and run-owned selections. Release on author-only/failure, retain uncertain effects and mark only confirmed live outcomes.

Decision: follow ADR-040 and docs/design/kk-itc-refactor.md; use a top-level DAG with bounded authoring FSM and reuse native discovery, store, decision, bot and executor seams. Rejected: expanding TARGET_PROFILES or introducing a router service, because both perpetuate duplicated ownership. Scope: plugins/kk/workflows/kk-itc.yaml topic entry; apps/cli store/stage helpers; plugins/kk/commands/workflow-run.md input parsing; collected-topic tests.

Invariants: optional ingestion; draft-first operation; explicit live and image intent; no automated login; no data loss; exact target identity; legacy direct invocation stays valid. Material premises verified at apps/cli/src/commands/store.ts:1277; plugins/kk/workflows/kk-collect.yaml:1.

Execution budget: 8 engineering hours; one task pipeline attempt with at most one bounded repair per failing behavior before reporting unresolved evidence. Implementation must produce a meaningful source diff and behavioral tests. Persist diagnostics in the task run directory and durable verification evidence; resume from partial work rather than replaying remote effects.

Test seam: Bun tests with fake transports/store pools, catalog stubs and temporary plugin assets; never real publication, login, or paid generation. Each task updates its surface docs in the same change; final task handles integration consistency.

Current design amendment:
Collected topic intake runs before final workspace allocation. Keep preselection scratch under the parent run; validate the selected topic slug and copy pool/provenance into the config-derived topic workspace. Coordinate the node output contract with the DAG owner; direct topic/file modes still bypass collection.

### Plan

1. Read the owned code, all callers, feature scenarios and design; confirm dependency outputs before edits.
2. Implement the selected behavior at its existing ownership seam, preserving validation, errors and compatibility.
3. Add behavior tests for each mapped scenario and its malformed/degraded boundary; assert side effects are absent on refusal.
4. Run changed-scope checks while iterating, then the project lint/test/build/rule checks through the task pipeline.
5. Update relevant surface documentation, preserve evidence and complete independent review/verification before task closure.
6. Apply the 2026-10-15 design amendment and exercise its added scenarios; use only the current revision contracts.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
