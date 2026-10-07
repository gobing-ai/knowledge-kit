---
schema_version: 1
name: kk-daily-ai-voice2 DAG workflow with safety sub-workflow and plugin-owned stages
status: todo
template: feature-impl
created_at: 2026-10-07T03:58:06.076Z
updated_at: "2026-10-07T22:04:30.799Z"
feature_id: G11
priority: P1
tags:
  - voice2
  - dag
  - workflow
estimate_hours: 10

dependencies: ["0210", "0207"]
---

## 0211. kk-daily-ai-voice2 DAG workflow with safety sub-workflow and plugin-owned stages

### Background

Implements: R1 — kk-daily-ai-voice2 is a DAG that starts from the store; R2 — Independent branches of the daily DAG run concurrently and fan in; R3 — Empty pool ends the daily DAG as no-content, not failed; R4 — Every DAG node is a single kk command with plugin-owned logic; R5 — The safety revise loop runs as a nested state-machine sub-workflow.

Design: docs/design/kk-collect-and-daily-voice2.md §6. Engine facts were verified in ts-dual-workflow-engine 0.5.16:
- `src/types.ts:208` `DagNodeDef { id, action?, dependsOn?, dependencyPolicy?, condition?, pause?, resumeRerun? }`.
- `src/dag.ts:168` runs a wave via `Promise.all`; `:219` `runActionStep` accepts any action kind (agent.run legal).
- `:126-136` handles skips: all deps skipped skips the node, a mix of done and skipped proceeds; any failure fails fast.
- There is no sub-workflow action. ADR-031.

### Requirements

- [ ] R1. `plugins/kk/workflows/kk-daily-ai-voice2.yaml` uses `kind: dag` with the node map of design §6. `spur workflow validate` passes and `kk-daily-ai-voice.yaml` stays byte-identical.
- [ ] R2. Head chain, in single-node waves:
  - `prepare`: `kk ledger sync --workflow kk-daily-ai-voice2`, plus the work dir and run date written to fixed files.
  - `read-work-dir` / `read-run-date`: `file.read.into-var`.
  - `extract`: `kk store extract --topic ai-news --window ${vars.window} --exclude-used kk-daily-ai-voice2 --out ${vars.work_dir}/10-collect/pool.json`.

  The head chain has no collect, ingest or label node, and there is no `setVars` or `file.read.into-var` after `extract`.
- [ ] R3. Every node action is exactly one of: a `kk` command, an `agent.run`, `spur workflow run …`, or `file.read.into-var` (head chain only). There is no `bun -e`, inline jq or path arithmetic. Nodes exchange data only through fixed paths under `${vars.work_dir}`.
- [ ] R4. `plugins/kk/workflows/kk-daily-safety.yaml` is a `kind: state-machine` ported from the current `safety-review` / `safety-judge` / `safety-revise` states, bounded by `safety_max_revise`. The voice2 `safety` node runs `spur workflow run plugins/kk/workflows/kk-daily-safety.yaml --vars '{"work_dir":…,"run_date":…}'`, which blocks and exits non-zero only on `block` or an integrity failure. The operator `review` node follows with `pause: true`.
- [ ] R5. Every fan-out root after `extract` has `condition: { kind: shell, command: "kk store pool-count ${vars.work_dir}/10-collect/pool.json --min 1" }`, or the equivalent guard that 0210's `{count}` output supports. `run-report` and `ledger` list `extract` in `dependsOn`, so an empty pool runs them and they record `no-content`.
- [ ] R6. Soft channels (xhs, wechat, locales) keep their exit-0-on-soft-failure kk stages. `publish-classify` uses `dependsOn` on every publish leaf with policy `all`. With `publish_enabled=false`, a condition skips the publish subtree.
- [ ] R7. Any stage voice2 touches moves from `plugins/kk/scripts/kk-workflow-stages.ts` into its owning plugin or a `kk` subcommand, together with its tests, and voice still calls it through the same `kk stage` name (thin delegate). Untouched voice-only stages stay.
- [ ] R8. `mark-used` (`kk store mark-used --workflow kk-daily-ai-voice2 --run … --in <plan docs>`) runs after `publish-classify`. `ledger` (`kk ledger append`) is the final node.

### Acceptance Criteria

- [ ] AC1 — kk-daily-ai-voice2 is a DAG that starts from the store
- [ ] AC2 — Independent branches of the daily DAG run concurrently and fan in
- [ ] AC3 — Empty pool ends the daily DAG as no-content, not failed
- [ ] AC4 — Every DAG node is a single kk command with plugin-owned logic
- [ ] AC5 — The safety revise loop runs as a nested state-machine sub-workflow
- [ ] AC6 — Safety sub-workflow judge verdicts carry a HIGH, MEDIUM, or LOW confidence level

Testing: before writing code, list every way the unit can fail (failure-first list in the task), then code; prove behavior with one E2E-style bun:test over a temp dir / temp DB, leaving a repeatable artifact under .works/test-artifacts/.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T03:59:06.702Z

- Safety loop: a nested `kk-daily-safety.yaml` state-machine invoked through `spur workflow run`. The engine has no sub-workflow action and the DAG has no back-edges (ts-dual-workflow-engine src/dag.ts).
- Operator review becomes a `pause: true` node after safety. Resuming runs the rest.
- Soft channels (xhs, wechat, locales) keep exiting 0 on soft failure, because the DAG is fail-fast.
- Stage moves happen only for stages voice2 touches. Untouched voice-only stages stay in kk-workflow-stages.ts until the old workflow retires.

### Design

Chosen: a DAG with node chains for today's multi-action states (prep → agent → post as three nodes) and the safety loop delegated to a nested state-machine, because the engine allows one action per node and no back-edges.

Rejected:
- keeping the FSM (no concurrency);
- unrolling the revise loop into DAG nodes (fixed revise count, duplicated nodes);
- passing data by vars (concurrent per-node `setVars` is last-writer-wins, `dag.ts:246`).

Invariants:
- Under the fail-fast DAG, soft targets must exit 0.
- Wave-level waiting is an accepted ceiling (ponytail: true critical-path scheduling is an engine change in ts-libs, not kk's).
- A failed run is still recorded, through `kk ledger sync` at the next run's `prepare`.

Files:
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml`, `plugins/kk/workflows/kk-daily-safety.yaml`;
- moved stages under `plugins/generations/*` or `apps/cli/src/commands/*`;
- `apps/cli/tests/voice2-dag.test.ts`, `docs/04_DESIGN.md`, the design-doc §6 sync.

If `kk store pool-count` is not already provided by 0210's `extract` output, add it in this task: `kk store pool-count <file> --min n` exits 0 if the count is at least n, else 1.

### Plan

- [ ] Failure-first list (empty pool, one branch fails, soft channel fails, safety block, revise bound hit, pause/resume of the operator review, publish disabled, sub-workflow binary missing).
- [ ] `kk-daily-safety.yaml` from the current safety states; validate; run it on a fixture script dir.
- [ ] voice2 node map; validate; dry run with `publish_enabled=false`.
- [ ] Move touched stages into plugins / kk subcommands with their tests.
- [ ] E2E `apps/cli/tests/voice2-dag.test.ts`, with stub agent nodes via a fake executor and a seeded store:
  - assert wall time ≈ the slowest branch for the article/cover/script wave;
  - publish-classify waits for all leaves;
  - an empty store gives a run that is done, with the ledger reading no-content.

  Copy the traces and ledger to `.works/test-artifacts/0211/`.
- [ ] `docs/04_DESIGN.md` + satellite §6 sync; `bun run gate`.
- [ ] Safety sub-workflow judge verdicts carry HIGH|MEDIUM|LOW (AC6): read the confidence from the verdict in the revise loop and in the draft-admission gate through the shared confidence-aware filter, and prove with fixtures that a missing/out-of-enum level is refused, named, and never deadlocks the loop (pattern: plugins/kk/tests/verdict-confidence.test.ts).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

- **Parked partial:** branch `sp/wip-0211-partial-20261007-202740` (commit `ebd38fb7`, "chore(0211): park the partial 0211 implementation (UNVERIFIED, R7 incomplete)") holds the implement dispatch that died on a provider error 2026-10-07 after 58 min. Produces validating `kk-daily-ai-voice2.yaml` + `kk-daily-safety.yaml`, the `kk daily` noun module, tests, and cli/ledger/store edits — but R7 (plugin-owned stages in `kk-workflow-stages.ts`) is NOT done and nothing is verified.
- **Resume path:** branch is based on `7552b050` (task 0213), 17 commits behind main — rebase onto main (expect conflicts in `cli.ts`/`ledger.ts`/`store.ts`), finish R7, then run the pipeline. Do not merge the branch as-is: it is uncertified by design.
- **Recovery notes (gitignored):** `.spur/run/4606d18a-5223-46e1-9d8d-d8887db48807-implement-partial.md`; `/Users/robin/.pi/agent/checkpoints/g31-runall-checkpoint.md`.

### History
