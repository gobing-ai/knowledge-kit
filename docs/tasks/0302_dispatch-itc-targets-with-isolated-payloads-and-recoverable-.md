---
schema_version: 1
name: Dispatch ITC targets with isolated payloads and recoverable receipts
status: todo
template: feature-impl
created_at: 2026-10-15T21:59:21.906Z
updated_at: "2026-10-15T22:33:14.778Z"
ac_altitude: task-local
ac_numbering: task-local
feature_id: G21
priority: P2
tags:
  - kk-itc
  - G21
estimate_hours: 12

dependencies: ["0298", "0300", "0301"]
---

## 0302. Dispatch ITC targets with isolated payloads and recoverable receipts

### Background

Current kk-itc has shipped authoring and fan-out but centralizes channel policy, duplicates browser routing and permits weak artifact evidence. This slice delivers: Replace channel-specific browser cursor dispatch with executor fan-out and existing serial-target controls. Adapt immutable shared editorial variants and stamp isolated target payloads. Run plugin probes and report bot recovery. Bind exact target receipts to plan/content identity, refuse absent runtime evidence, preserve successes and reconcile uncertain remote effects before retry. Keep live confirmation and image opt-ins.

Implements feature G21 scenarios: R7 — Session recovery stays with bots and channel probes; R8 — Publication dispatch isolates targets and reuses fan-out; R9 — Runtime outcomes require valid current artifacts; R10 — Recovery preserves success and refuses uncertain repeats; R11 — Reports reconcile every expected target.

Owned surface: plugins/kk/workflows/kk-itc.yaml publish/judge/report tail; plugins/kk/scripts/itc-stages.ts; native planner/receipt helpers; executor fanout only where necessary; publish/adapt skills; regression tests.

Verified premises: plugins/kk/scripts/itc-stages.ts:130; apps/cli/src/fanout.ts:196; apps/cli/src/commands/bot.ts:71. Full contract: docs/design/kk-itc-refactor.md. Preserve existing Content → Result, direct entry execution and plugin-owned validation. No new service or live account is needed.

Rubric: E12 D1 L3 C1 R2 = 19; independent behavior/risk boundary with implementation and tests together. Above the 8h target retained as one cohesive receipt/dispatch review surface; below the 16h forced split. Separate retry-only work would duplicate the receipt-state contract.

Ordering: after Plan ITC publication from discovered plugin capabilities, Resolve topic channel presets with explicit target overrides, Persist bounded ITC semantic decisions and safe fallbacks. Shared workflow/stage surfaces are sequenced, not concurrently edited.

2026-10-15 operator feedback amendment: Own the top-level kk-itc dependency DAG and DAG-safe publish/recovery scheduling. Wire the bounded authoring child owned by 0301, validate its completion receipt and join optional branches without losing report execution on skips. Files carry data; concurrent vars never establish predecessor completion. Prove cancellation reaches the child, each node replay contract is explicit, successful sends never replay, and hard failures retain partial evidence. Add the small off|handoff SEO branch: strict content-bound prepublish request, typed disabled/not-assessed status when draft analysis is unavailable, and confirmed-public-URL evidence after live sends. No G9 runtime dependency, draft optimizer, crawler or new plugin kind. Use existing executor fan-out inside the publish node rather than one YAML node per target. Draft changes from any future SEO response require renewed technical review and invalidate downstream receipts.

Also implements G21 R13 — DAG branches require verified predecessor completion.

Also implements G21 R16 — SEO handoff remains independent of an unfinished provider.

### Requirements

- [ ] R1. Session recovery stays with bots and channel probes; the plugin probe refuses the send and reports operator-directed kk bot recovery without treating cached state as authenticated or automating login.
- [ ] R2. Publication dispatch isolates targets and reuses fan-out; each target receives its own validated payload through executor fan-out and shared browser profiles are serialized without leaking another target metadata.
- [ ] R3. Runtime outcomes require valid current artifacts; it refuses success and preserves diagnostic evidence while explicit dry-run behavior remains isolated.
- [ ] R4. Recovery preserves success and refuses uncertain repeats; it retains the successful receipt, retries only the safe failure within the budget and requires reconciliation for the uncertain target.
- [ ] R5. Reports reconcile every expected target; it reports a contract failure with expected and observed targets and never claims complete publication.
- [ ] R6. DAG branches require verified predecessor completion; publishing waits for validated child completion, optional skips still allow a run report, and cancellation stops the owned child.
- [ ] R7. SEO handoff remains independent of an unfinished provider; it exports versioned content-bound evidence and records not-assessed while authoring continues and only confirmed public URLs enter the later URL-audit handoff.

### Acceptance Criteria

```gherkin
Feature: Dispatch ITC targets with isolated payloads and recoverable receipts

  Scenario: AC1 — Session recovery stays with bots and channel probes (req: R1)
    Given a browser publication target with a cached bot and an expired or challenged session
    When publication readiness is checked
    Then the plugin probe refuses the send and reports operator-directed kk bot recovery without treating cached state as authenticated or automating login

  Scenario: AC2 — Publication dispatch isolates targets and reuses fan-out (req: R2)
    Given compatible file and script targets sharing an adapted variant with different mode metadata
    When the frozen plan is dispatched
    Then each target receives its own validated payload through executor fan-out and shared browser profiles are serialized without leaking another target metadata

  Scenario: AC3 — Runtime outcomes require valid current artifacts (req: R3)
    Given a runtime judge or report artifact that is absent, malformed or belongs to different inputs
    When the workflow evaluates completion
    Then it refuses success and preserves diagnostic evidence while explicit dry-run behavior remains isolated

  Scenario: AC4 — Recovery preserves success and refuses uncertain repeats (req: R4)
    Given a plan with one confirmed success, one repeat-safe failure and one uncertain remote outcome
    When publication recovery runs
    Then it retains the successful receipt, retries only the safe failure within the budget and requires reconciliation for the uncertain target

  Scenario: AC5 — Reports reconcile every expected target (req: R5)
    Given a frozen plan whose result aggregate omits, duplicates or adds a target or contains stale evidence
    When the run report is produced
    Then it reports a contract failure with expected and observed targets and never claims complete publication
  Scenario: AC6 — DAG branches require verified predecessor completion (req: R6)
    Given a DAG with optional branches and a paused or failed authoring child
    When dependent work is scheduled
    Then publishing waits for validated child completion, optional skips still allow a run report, and cancellation stops the owned child

  Scenario: AC7 — SEO handoff remains independent of an unfinished provider (req: R7)
    Given SEO handoff mode and a reviewed draft without a shipped draft-capable SEO adapter
    When the SEO branch runs
    Then it exports versioned content-bound evidence and records not-assessed while authoring continues and only confirmed public URLs enter the later URL-audit handoff

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Replace channel-specific browser cursor dispatch with executor fan-out and existing serial-target controls. Adapt immutable shared editorial variants and stamp isolated target payloads. Run plugin probes and report bot recovery. Bind exact target receipts to plan/content identity, refuse absent runtime evidence, preserve successes and reconcile uncertain remote effects before retry. Keep live confirmation and image opt-ins.

Decision: follow ADR-040 and docs/design/kk-itc-refactor.md; use a top-level DAG with bounded authoring FSM and reuse native discovery, store, decision, bot and executor seams. Rejected: expanding TARGET_PROFILES or introducing a router service, because both perpetuate duplicated ownership. Scope: plugins/kk/workflows/kk-itc.yaml publish/judge/report tail; plugins/kk/scripts/itc-stages.ts; native planner/receipt helpers; executor fanout only where necessary; publish/adapt skills; regression tests.

Invariants: optional ingestion; draft-first operation; explicit live and image intent; no automated login; no data loss; exact target identity; legacy direct invocation stays valid. Material premises verified at plugins/kk/scripts/itc-stages.ts:130; apps/cli/src/fanout.ts:196; apps/cli/src/commands/bot.ts:71.

Execution budget: 12 engineering hours; one task pipeline attempt with at most one bounded repair per failing behavior before reporting unresolved evidence. Implementation must produce a meaningful source diff and behavioral tests. Persist diagnostics in the task run directory and durable verification evidence; resume from partial work rather than replaying remote effects.

Test seam: Bun tests with fake transports/store pools, catalog stubs and temporary plugin assets; never real publication, login, or paid generation. Each task updates its surface docs in the same change; final task handles integration consistency.

Current design amendment:
Own the top-level kk-itc dependency DAG and DAG-safe publish/recovery scheduling. Wire the bounded authoring child owned by 0301, validate its completion receipt and join optional branches without losing report execution on skips. Files carry data; concurrent vars never establish predecessor completion. Prove cancellation reaches the child, each node replay contract is explicit, successful sends never replay, and hard failures retain partial evidence. Add the small off|handoff SEO branch: strict content-bound prepublish request, typed disabled/not-assessed status when draft analysis is unavailable, and confirmed-public-URL evidence after live sends. No G9 runtime dependency, draft optimizer, crawler or new plugin kind. Use existing executor fan-out inside the publish node rather than one YAML node per target. Draft changes from any future SEO response require renewed technical review and invalidate downstream receipts.

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
