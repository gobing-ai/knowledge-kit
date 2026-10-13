---
schema_version: 1
name: Make a failed safety reviewer reach the gate instead of aborting the nested run
status: todo
template: issue
created_at: 2026-10-12T23:05:01.855Z
updated_at: "2026-10-13T20:57:06.845Z"
feature_id: G11

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 1
---

## 0270. Make a failed safety reviewer reach the gate instead of aborting the nested run

### Background

The 2026-10-12 daily safety run could abort inside the nested `kk-daily-safety` machine when the reviewer or judge agent failed before producing its expected artifact. The authored workflow already described the missing report/verdict as fail-closed, but the engine's default action policy stopped the state before `daily-safety-gate` could classify the missing artifact and write `safety_status=block`.

Current-tree audit (2026-10-13): `plugins/kk/workflows/kk-daily-safety.yaml` carries `onError: continue` on the `review`, `judge`, and existing `revise` agent actions. The judge state's gate shell remains after the judge action, the judge-to-block fallback remains unconditional, and `kk-daily-ai-voice2.yaml` keeps its safety node fail-fast. `plugins/kk/tests/safety-reviewer-failure.test.ts` reads the authored machine and exercises the real judge accept guard with missing/invalid artifact fixtures; `apps/cli/tests/voice2-dag.test.ts` also pins the full agent-step shape.

**Refine corrections (2026-10-13)**

- The old Solution cited only a structural test in `apps/cli/tests/voice2-dag.test.ts` and a historical manual probe. The repository now has the focused `plugins/kk/tests/safety-reviewer-failure.test.ts`; it is the primary regression evidence and must remain in the plan.
- The failure policy is deliberately limited to the three agent actions. The deterministic prep/gate shells keep the default fail behavior, and the parent DAG safety node must not gain `onError: continue`, because a nested `block` must prevent publishing.

The task remains scoped to authored workflow policy and its regression tests; no workflow-engine change or fail-open safety behavior is required.

### Requirements

- [ ] R1. A failure of the `review` agent action continues through the same state transition so `daily-safety-gate` can classify a missing or malformed review report as `block`.
- [ ] R2. A failure of the `judge` agent action continues to the gate shell in the same `judge` state; an absent or invalid verdict cannot take the `clean` edge and must reach the declared `block` terminal.
- [ ] R3. The `revise` agent remains failure-tolerant, while the deterministic prep/gate shells keep their default failure policy and the parent voice2 `safety` node remains fail-fast on a non-zero nested result.
- [ ] R4. Regression tests parse the shipped YAML and observe the reviewer `expectFile` paths, `onError` policies, gate ordering, declaration-order fallback, and parent fail-fast boundary.

Out of scope: changing the workflow engine's action semantics, making a missing safety artifact publishable, adding retries to reviewer agents, or changing the safety verdict schema.

### Acceptance Criteria

```gherkin
Scenario: AC1 — a failed review reaches the fail-closed gate (req: R1, R4)
  Given the `review` agent action cannot write `_09_safety-review_report.json`
  When the `kk-daily-safety` machine is inspected and its review edge is evaluated
  Then the action has `onError: continue`, the expected report path remains pinned, and the next state is `judge` rather than an action abort

Scenario: AC2 — a failed judge reaches the gate and cannot be admitted (req: R2, R4)
  Given the `judge` agent action cannot write `_09_safety-judge_verdict.json`
  When the judge state's actions and outbound guards are evaluated
  Then the action has `onError: continue`, `daily-safety-gate` follows it, the clean guard refuses the missing/invalid verdict, and the unconditional fallback reaches `block`

Scenario: AC3 — safety failure still stops publication (req: R3, R4)
  Given the nested safety machine returns its declared `block` failure
  When the voice2 workflow definition is inspected
  Then the parent `safety` node has no `onError: continue` and still shells the nested machine as a fail-fast boundary

Scenario: AC4 — deterministic shell failures are not swallowed (req: R3, R4)
  Given the review or judge prep/gate shell fails
  When the authored actions are inspected
  Then those shell actions have no `onError: continue` override
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-13T20:56:33.118Z

#### Closed decision — gate owns fail-closed classification
Reviewer and judge agent failures are tolerated only long enough to reach the existing gate. Missing or malformed artifacts remain blocked; no failed agent is treated as a pass.

#### Closed decision — preserve the parent boundary
The nested machine's `block` terminal remains non-zero and the voice2 DAG safety node remains fail-fast. This prevents a tolerated inner action from becoming a publishable daily run.

#### Closed decision — test level
Use the real YAML plus the real guard commands in `plugins/kk/tests/safety-reviewer-failure.test.ts`; do not add an agent-spawning integration test that depends on credentials or a live executor.

### Design

Change only `plugins/kk/workflows/kk-daily-safety.yaml` and its focused regression coverage. Set `onError: continue` on the `review` and `judge` `agent.run` actions (the `revise` action already has it). Keep the `review -> judge` transition unconditional and keep the judge state's action order as `agent.run` → `daily-safety-gate` shell → status read.

The gate already writes a blocked status for a missing/malformed report or verdict and the declared `judge -> block` edge is the unconditional last edge. Its clean guard must continue to require an admitted verdict and valid confidence/stamp. The prep and gate shell actions keep the default failure policy. The parent `safety` action in `kk-daily-ai-voice2.yaml` keeps no `onError`, so a nested block remains fail-fast.

Tests should parse the shipped YAML rather than copy selector strings, assert the two reviewer `expectFile` paths and policies, run the real judge guard against temporary verdict/stamp fixtures, and assert declaration order plus the parent boundary. Reuse `plugins/kk/tests/safety-reviewer-failure.test.ts`; retain the complementary `apps/cli/tests/voice2-dag.test.ts` structural assertion.

### Plan

1. Re-read `kk-daily-safety.yaml` and the parent voice2 safety node; confirm the three agent policies, gate ordering, block edge, and parent boundary.
2. Keep or add the focused YAML/guard tests in `plugins/kk/tests/safety-reviewer-failure.test.ts`; keep the complementary voice2 DAG test.
3. Run those focused tests plus `spur workflow validate plugins/kk/workflows/kk-daily-safety.yaml --json`.
4. If the authored workflow and tests remain as audited, make no production edit; the task is ready for verification handoff.

### Root Cause

The root cause was an authored-policy mismatch: reviewer `agent.run` actions inherited the engine's default fail policy even though the following gate was the component that knew how to classify absent artifacts. A failed action therefore aborted the state before the gate and left no blocked status. The minimal correction is `onError: continue` on the agent actions only, with the existing gate and parent fail-fast boundaries intact.

### Solution

The current production correction is at `plugins/kk/workflows/kk-daily-safety.yaml:60-95`:

- `plugins/kk/workflows/kk-daily-safety.yaml` sets `onError: continue` on `review` and `judge`; `revise` already had the same policy. The judge gate shell remains later in the same `onEnter` list.
- `plugins/kk/tests/safety-reviewer-failure.test.ts:101-164` pins the real reviewer paths, action policies, gate order, confidence-aware clean guard, unconditional block fallback, and parent DAG fail-fast boundary. `apps/cli/tests/voice2-dag.test.ts:698-735` keeps the broader structural check.
- The parent safety node remains fail-fast at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:484-504`.

No workflow-engine or production safety-schema change is needed. The remaining handoff is focused verification of this authored policy.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
