---
schema_version: 1
name: Resolve topic channel presets with explicit target overrides
status: todo
template: feature-impl
created_at: 2026-10-15T21:59:21.904Z
updated_at: "2026-10-15T22:31:43.593Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 6

dependencies: ["0298", "0299"]
---

## 0300. Resolve topic channel presets with explicit target overrides

### Background

Current kk-itc has shipped authoring and fan-out but centralizes channel policy, duplicates browser routing and permits weak artifact evidence. This slice delivers: Add optional publishPreset to existing topic profiles without changing extraction queries. Resolve strict project/package preset assets and plugin:profile selectors. Explicit targets replace all presets; resolve a frozen intent with provenance. Reject missing/incompatible modes before sends.

Implements feature G21 scenarios: R6 — Topic presets resolve an inspectable frozen plan.

Owned surface: topic-profile parser; plugins/kk/publish-presets assets; ITC planner; workflow-run preset args; preset/packaging tests.

Verified premises: plugins/kk/decisions/extract/ai-news.yaml:15; plugins/kk/scripts/itc-stages.ts:385. Full contract: docs/design/kk-itc-refactor.md. Preserve existing Content → Result, direct entry execution and plugin-owned validation. No new service or live account is needed.

Rubric: E6 D1 L3 C1 R1 = 12; independent behavior/risk boundary with implementation and tests together. 

Ordering: after Plan ITC publication from discovered plugin capabilities, Select evidence-backed ITC topics from the collection store. Shared workflow/stage surfaces are sequenced, not concurrently edited.

2026-10-15 operator feedback amendment: Read preset defaults from the frozen workflows.kk-itc effective-options object. Explicit targets/preset still win. Preset provenance and config digest are bound to the plan; a changed ambient config during resume never changes target intent.

### Requirements

- [ ] R1. Topic presets resolve an inspectable frozen plan; explicit targets replace preset targets and the frozen plan records its origin, operations, variants and draft mode while invalid presets fail before sends.

### Acceptance Criteria

```gherkin
Feature: Resolve topic channel presets with explicit target overrides

  Scenario: AC1 — Topic presets resolve an inspectable frozen plan (req: R1)
    Given a topic profile selecting a channel preset and an explicit target override
    When the publication plan is resolved
    Then explicit targets replace preset targets and the frozen plan records its origin, operations, variants and draft mode while invalid presets fail before sends
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Add optional publishPreset to existing topic profiles without changing extraction queries. Resolve strict project/package preset assets and plugin:profile selectors. Explicit targets replace all presets; resolve a frozen intent with provenance. Reject missing/incompatible modes before sends.

Decision: follow ADR-040 and docs/design/kk-itc-refactor.md; use a top-level DAG with bounded authoring FSM and reuse native discovery, store, decision, bot and executor seams. Rejected: expanding TARGET_PROFILES or introducing a router service, because both perpetuate duplicated ownership. Scope: topic-profile parser; plugins/kk/publish-presets assets; ITC planner; workflow-run preset args; preset/packaging tests.

Invariants: optional ingestion; draft-first operation; explicit live and image intent; no automated login; no data loss; exact target identity; legacy direct invocation stays valid. Material premises verified at plugins/kk/decisions/extract/ai-news.yaml:15; plugins/kk/scripts/itc-stages.ts:385.

Execution budget: 6 engineering hours; one task pipeline attempt with at most one bounded repair per failing behavior before reporting unresolved evidence. Implementation must produce a meaningful source diff and behavioral tests. Persist diagnostics in the task run directory and durable verification evidence; resume from partial work rather than replaying remote effects.

Test seam: Bun tests with fake transports/store pools, catalog stubs and temporary plugin assets; never real publication, login, or paid generation. Each task updates its surface docs in the same change; final task handles integration consistency.

Current design amendment:
Read preset defaults from the frozen workflows.kk-itc effective-options object. Explicit targets/preset still win. Preset provenance and config digest are bound to the plan; a changed ambient config during resume never changes target intent.

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
