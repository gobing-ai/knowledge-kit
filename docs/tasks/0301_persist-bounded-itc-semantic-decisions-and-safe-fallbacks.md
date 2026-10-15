---
schema_version: 1
name: Persist bounded ITC semantic decisions and safe fallbacks
status: todo
template: feature-impl
created_at: 2026-10-15T21:59:21.905Z
updated_at: "2026-10-15T22:33:13.394Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 8

dependencies: ["0299", "0300"]
---

## 0301. Persist bounded ITC semantic decisions and safe fallbacks

### Background

Current kk-itc has shipped authoring and fan-out but centralizes channel policy, duplicates browser routing and permits weak artifact evidence. This slice delivers: Introduce fixed-choice topic/outline/preset catalog decisions and persist raw source/default provenance bound to evidence. Validate returned slots against real candidates. Explicit selections win; defer stops safely. Decisions never grant send/live/spend authority.

Implements feature G21 scenarios: R4 — Semantic choices remain within validated candidates.

Owned surface: plugins/kk/decisions/kk-itc.yaml; ITC decision stage helpers; outline/topic/preset workflow states; decision-catalog and degradation tests.

Verified premises: plugins/kk/decisions/kk-items.yaml:18; plugins/kk/scripts/itc-stages.ts:94. Full contract: docs/design/kk-itc-refactor.md. Preserve existing Content → Result, direct entry execution and plugin-owned validation. No new service or live account is needed.

Rubric: E8 D1 L3 C1 R1 = 14; independent behavior/risk boundary with implementation and tests together. 

Ordering: after Select evidence-backed ITC topics from the collection store, Resolve topic channel presets with explicit target overrides. Shared workflow/stage surfaces are sequenced, not concurrently edited.

2026-10-15 operator feedback amendment: Own the bounded authoring FSM and its coordination with the top-level DAG. Include outline selection, manual/auto revision, technical judgment and unslop; the child never publishes. Persist deterministic parent/child run IDs before launch; use supported Spur run/continue output and preserve that exact child across every interactive pause. The workflow entry controls the parent authoring barrier, while a deterministic draft receipt prevents premature parent continuation. Test multiple child pauses, launch/receipt crash recovery and child failure before enabling this path. Do not assume a paused child is a successful nested shell command. Update workflow-run entry instructions and resolve installed child YAML paths using existing resolution. Read docs/design/kk-itc-refactor.md DAG section for the fixed coordination contract.

Also implements G21 R17 — Interactive authoring resumes the recorded child.

### Requirements

- [ ] R1. Semantic choices remain within validated candidates; the workflow records source and fallback reason and uses the declared safe default or requires operator selection without enabling publication or spending.
- [ ] R2. Interactive authoring resumes the recorded child; it continues the same child ID through repeated pauses and resumes the parent only after validating the child draft receipt without rerunning confirmed sends.

### Acceptance Criteria

```gherkin
Feature: Persist bounded ITC semantic decisions and safe fallbacks

  Scenario: AC1 — Semantic choices remain within validated candidates (req: R1)
    Given topic, outline or preset choices with a fixed candidate set
    When a catalog decision returns a missing, malformed or out-of-set result
    Then the workflow records source and fallback reason and uses the declared safe default or requires operator selection without enabling publication or spending
  Scenario: AC2 — Interactive authoring resumes the recorded child (req: R2)
    Given a parent DAG paused at its authoring barrier and a child paused for outline or revision input
    When the workflow entry resumes authoring
    Then it continues the same child ID through repeated pauses and resumes the parent only after validating the child draft receipt without rerunning confirmed sends

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Introduce fixed-choice topic/outline/preset catalog decisions and persist raw source/default provenance bound to evidence. Validate returned slots against real candidates. Explicit selections win; defer stops safely. Decisions never grant send/live/spend authority.

Decision: follow ADR-040 and docs/design/kk-itc-refactor.md; use a top-level DAG with bounded authoring FSM and reuse native discovery, store, decision, bot and executor seams. Rejected: expanding TARGET_PROFILES or introducing a router service, because both perpetuate duplicated ownership. Scope: plugins/kk/decisions/kk-itc.yaml; ITC decision stage helpers; outline/topic/preset workflow states; decision-catalog and degradation tests.

Invariants: optional ingestion; draft-first operation; explicit live and image intent; no automated login; no data loss; exact target identity; legacy direct invocation stays valid. Material premises verified at plugins/kk/decisions/kk-items.yaml:18; plugins/kk/scripts/itc-stages.ts:94.

Execution budget: 8 engineering hours; one task pipeline attempt with at most one bounded repair per failing behavior before reporting unresolved evidence. Implementation must produce a meaningful source diff and behavioral tests. Persist diagnostics in the task run directory and durable verification evidence; resume from partial work rather than replaying remote effects.

Test seam: Bun tests with fake transports/store pools, catalog stubs and temporary plugin assets; never real publication, login, or paid generation. Each task updates its surface docs in the same change; final task handles integration consistency.

Current design amendment:
Own the bounded authoring FSM and its coordination with the top-level DAG. Include outline selection, manual/auto revision, technical judgment and unslop; the child never publishes. Persist deterministic parent/child run IDs before launch; use supported Spur run/continue output and preserve that exact child across every interactive pause. The workflow entry controls the parent authoring barrier, while a deterministic draft receipt prevents premature parent continuation. Test multiple child pauses, launch/receipt crash recovery and child failure before enabling this path. Do not assume a paused child is a successful nested shell command. Update workflow-run entry instructions and resolve installed child YAML paths using existing resolution. Read docs/design/kk-itc-refactor.md DAG section for the fixed coordination contract.

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
