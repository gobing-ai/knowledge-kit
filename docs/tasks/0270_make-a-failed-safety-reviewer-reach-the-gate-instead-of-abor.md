---
schema_version: 1
name: Make a failed safety reviewer reach the gate instead of aborting the nested run
status: todo
template: issue
created_at: 2026-10-12T23:05:01.855Z
updated_at: "2026-10-13T05:36:44.849Z"
feature_id: G11

ac_altitude: task-local
---

## 0270. Make a failed safety reviewer reach the gate instead of aborting the nested run

### Background

Captured from the creation title: "Make a failed safety reviewer reach the gate instead of aborting the nested run".

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

Implemented in 1742d6e7 (2026-10-12 hardening pass):

- `plugins/kk/workflows/kk-daily-safety.yaml:61` and `:80` — `onError: continue` on the `review` and `judge` `agent.run` steps (the `revise` step already carried it at `:107`). R4's engine question was settled empirically before the change: after a tolerated failure the engine still runs the state's later `onEnter` actions (probe `.spur/run/hardening-probe/probe.yaml` — the second shell action ran in the failing case), so the gate following the judge agent is not skipped.
- Verified end to end with an unusable reviewer (`--vars agent=no-such-executor` over a prepared workspace): the machine ends `workflow failed: kk-daily-safety -> block — failed-check` and `24-script/<date>_09_safety-judge_status.txt` contains `block`. Before the change the same input ended `-> review` and wrote no status file at all.
- Test at `apps/cli/tests/voice2-dag.test.ts:698`: every `agent.run` in the machine must carry `onError: continue`, and the gate shell must follow the judge agent in the same state. Falsified: reverting the workflow fails it with `review must tolerate its agent failing`.

R5 is unchanged: `block` still fails the parent node (the drafts must not publish) and voice2's `safety` node keeps no `onError`. The gain is a declared terminal with a recorded status, a written block reason and a step-timing entry, instead of an abort that also loses `run-report` and the ledger row. R6 is met by that structural test rather than an agent-spawning E2E: the failing-agent behaviour is pinned by the probe above, which is repeatable but not part of the suite (it exercised real executor failover for ~26 minutes).

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
