---
schema_version: 1
name: "kk-daily-ai-voice2: every agent.run node exits 0 without writing its expected file, so each daily run ends failed"
status: todo
template: issue
created_at: 2026-10-09T17:05:14.052Z
updated_at: "2026-10-09T17:05:49.660Z"
feature_id: G11

priority: P1
ac_altitude: task-local
---

## 0238. kk-daily-ai-voice2: every agent.run node exits 0 without writing its expected file, so each daily run ends failed

### Background

Found during the G32 batch's live dogfood of `kk-daily-ai-voice2` (task 0230). Every dry run in that
batch ended `failed` at an `agent.run` node, after `select` had already committed its rows.

**Verified symptom** (direct evidence, this batch):

- `.works/kk-daily-ai-voice2/ledger.md` and `.works/test-artifacts/g32/voice2-run1.log`:
  `✗ plan-translate/agent.run (48s) · agent.run (coder) exited 0 but expected file is absent:
  .works/kk-daily-ai-voice2/20261009/21-plan/20261009_03_plan_plan.json; executor contract failure
  preserved at .spur/run/82388632-6011-4097-a8b2-4e9c08253f01-plan-translate-partial.md`
- The node declares that artifact at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:207`
  (`expectFile: ${vars.work_dir}/21-plan/${vars.run_date}_03_plan_plan.json`, agent at `:198`), and the
  engine preserved the executor's output as a `-partial.md` sidecar — i.e. the executor answered in
  prose instead of writing the declared path.
- `script-write` succeeded in the same run, so the executor was live; the failure is per-node contract,
  not a dead or mis-resolved executor.

**Scope, stated honestly.** The direct evidence above covers `plan-translate`. The 0230 review reported
the same class across the daily DAGs ("all four DAGs still end failed at their inline `agent.run`
nodes"), which this task must **confirm per node rather than assume** — the title is broader than the
evidence collected here for exactly that reason. The other declared artifacts in the workflow
(`:233`, `:280`, `:337`, `:534`) may or may not be affected.

**Consequence.** Each daily run reports `failed` while its `selections` rows stay committed (0228's
property), so the pool advances behind a failed job: the operator's scheduled run looks broken and the
failure is indistinguishable from a real pipeline error.

**Not caused by the store-v2 batch.** The shape predates it — the earlier artifact
`.works/test-artifacts/0211/voice2-concurrent-calls.log` shows the same node/executor behaviour.

### Requirements

- [ ] R1. Diagnose the violating side with `file:line`: does the `agent.run` node's declared input
  instruct the executor to write `expectFile`, or does the executor only answer in prose? Name either
  the workflow node (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:198-207`) or the skill/agent
  contract the node dispatches as the violator — do not change both.
- [ ] R2. Fix the violator so the declared artifact is produced, keeping the node's declared
  `expectFile` truthful (the artifact path must be what the run actually writes).
- [ ] R3. Confirm the blast radius per node: check every `agent.run` node in the workflow (`:198-207`,
  `:223-233`, `:272-280`, `:330-337`, `:525-534`, `:593`) for the same failure and record which ones
  reproduce it.
- [ ] R4. Keep the contract failure loud: an `agent.run` that exits 0 without its declared artifact
  must still fail its node, and the `-partial.md` executor output must stay preserved for diagnosis.
- [ ] R5. Prove it end-to-end: one dry run (`publish_enabled=false`) reaches `done` with every
  declared `expectFile` present on disk, and the run's ledger row records the nodes as done.

### Acceptance Criteria

- [ ] AC1 — A `kk-daily-ai-voice2` dry run reaches `done` with every `agent.run` node's declared `expectFile` present on disk.
- [ ] AC2 — An `agent.run` that exits 0 without writing its `expectFile` still fails its node and preserves the executor output.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
