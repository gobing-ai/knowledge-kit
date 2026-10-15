---
schema_version: 1
name: Plan ITC publication from discovered plugin capabilities
status: todo
template: feature-impl
created_at: 2026-10-15T21:59:21.896Z
updated_at: "2026-10-15T22:31:32.914Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 8

---

## 0298. Plan ITC publication from discovered plugin capabilities

### Background

Current kk-itc has shipped authoring and fan-out but centralizes channel policy, duplicates browser routing and permits weak artifact evidence. This slice delivers: Extend optional publishing profiles through manifest validation, discovery and packaging. Move ITC plan resolution to the application stage handler and derive built-in profiles from actual plugin mode/operation code. Keep legacy manifest invocation unchanged and refuse undeclared ITC planning.

Implements feature G21 scenarios: R5 — Publish plugins describe operation-specific capabilities.

Owned surface: packages/kk-core/src/manifest.ts; packages/kk-core/src/registry.ts; apps/cli/src/stage.ts; native ITC planner; publish plugin manifests; schema/discovery/planner tests.

Verified premises: packages/kk-core/src/manifest.ts:55; plugins/kk/scripts/itc-stages.ts:266. Full contract: docs/design/kk-itc-refactor.md. Preserve existing Content → Result, direct entry execution and plugin-owned validation. No new service or live account is needed.

Rubric: E8 D1 L3 C1 R1 = 14; independent behavior/risk boundary with implementation and tests together. 

Ordering: no prerequisites within this batch. Shared workflow/stage surfaces are sequenced, not concurrently edited.

2026-10-15 operator feedback amendment: The planner consumes the canonical effective-options snapshot and remains topology-independent. ADR-040 amended now selects a top-level DAG with a child authoring FSM; reject the obsolete pure-FSM framing. No publishing capability changes are required solely for DAG scheduling.

### Requirements

- [ ] R1. Publish plugins describe operation-specific capabilities; it uses those declarations without a channel table or channel-specific workflow edits and rejects an incompatible requested operation.

### Acceptance Criteria

```gherkin
Feature: Plan ITC publication from discovered plugin capabilities

  Scenario: AC1 — Publish plugins describe operation-specific capabilities (req: R1)
    Given a discovered publish plugin declaring supported format, locale, draft modes, requirements and metadata bindings
    When the publication planner resolves its operation
    Then it uses those declarations without a channel table or channel-specific workflow edits and rejects an incompatible requested operation
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend optional publishing profiles through manifest validation, discovery and packaging. Move ITC plan resolution to the application stage handler and derive built-in profiles from actual plugin mode/operation code. Keep legacy manifest invocation unchanged and refuse undeclared ITC planning.

Decision: follow ADR-040 and docs/design/kk-itc-refactor.md; use a top-level DAG with bounded authoring FSM and reuse native discovery, store, decision, bot and executor seams. Rejected: expanding TARGET_PROFILES or introducing a router service, because both perpetuate duplicated ownership. Scope: packages/kk-core/src/manifest.ts; packages/kk-core/src/registry.ts; apps/cli/src/stage.ts; native ITC planner; publish plugin manifests; schema/discovery/planner tests.

Invariants: optional ingestion; draft-first operation; explicit live and image intent; no automated login; no data loss; exact target identity; legacy direct invocation stays valid. Material premises verified at packages/kk-core/src/manifest.ts:55; plugins/kk/scripts/itc-stages.ts:266.

Execution budget: 8 engineering hours; one task pipeline attempt with at most one bounded repair per failing behavior before reporting unresolved evidence. Implementation must produce a meaningful source diff and behavioral tests. Persist diagnostics in the task run directory and durable verification evidence; resume from partial work rather than replaying remote effects.

Test seam: Bun tests with fake transports/store pools, catalog stubs and temporary plugin assets; never real publication, login, or paid generation. Each task updates its surface docs in the same change; final task handles integration consistency.

Current design amendment:
The planner consumes the canonical effective-options snapshot and remains topology-independent. ADR-040 amended now selects a top-level DAG with a child authoring FSM; reject the obsolete pure-FSM framing. No publishing capability changes are required solely for DAG scheduling.

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
