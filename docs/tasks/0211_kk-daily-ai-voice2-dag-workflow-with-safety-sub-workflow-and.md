---
schema_version: 1
name: kk-daily-ai-voice2 DAG workflow with safety sub-workflow and plugin-owned stages
status: done
template: feature-impl
created_at: 2026-10-07T03:58:06.076Z
updated_at: "2026-10-14T01:48:35.910Z"
feature_id: G11
priority: P1
tags:
  - voice2
  - dag
  - workflow
estimate_hours: 10

dependencies: ["0210", "0207"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0211-verdict.json
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

- [x] R1. `plugins/kk/workflows/kk-daily-ai-voice2.yaml` uses `kind: dag` with the node map of design §6. `spur workflow validate` passes and `kk-daily-ai-voice.yaml` stays byte-identical.
- [x] R2. Head chain, in single-node waves:
  - `prepare`: `kk ledger sync --workflow kk-daily-ai-voice2`, plus the work dir and run date written to fixed files.
  - `read-work-dir` / `read-run-date`: `file.read.into-var`.
  - `extract`: `kk store extract --topic ai-news --window ${vars.window} --exclude-used kk-daily-ai-voice2 --out ${vars.work_dir}/10-collect/pool.json`.

  The head chain has no collect, ingest or label node, and there is no `setVars` or `file.read.into-var` after `extract`.
- [x] R3. Every node action is exactly one of: a `kk` command, an `agent.run`, `spur workflow run …`, or `file.read.into-var` (head chain only). There is no `bun -e`, inline jq or path arithmetic. Nodes exchange data only through fixed paths under `${vars.work_dir}`.
- [x] R4. `plugins/kk/workflows/kk-daily-safety.yaml` is a `kind: state-machine` ported from the current `safety-review` / `safety-judge` / `safety-revise` states, bounded by `safety_max_revise`. The voice2 `safety` node runs `spur workflow run plugins/kk/workflows/kk-daily-safety.yaml --vars '{"work_dir":…,"run_date":…}'`, which blocks and exits non-zero only on `block` or an integrity failure. The operator `review` node follows with `pause: true`.
- [x] R5. Every fan-out root after `extract` has `condition: { kind: shell, command: "kk store pool-count ${vars.work_dir}/10-collect/pool.json --min 1" }`, or the equivalent guard that 0210's `{count}` output supports. `run-report` and `ledger` list `extract` in `dependsOn`, so an empty pool runs them and they record `no-content`.
- [x] R6. Soft channels (xhs, wechat, locales) keep their exit-0-on-soft-failure kk stages. `publish-classify` uses `dependsOn` on every publish leaf with policy `all`. With `publish_enabled=false`, a condition skips the publish subtree.
- [x] R7. Any stage voice2 touches moves from `plugins/kk/scripts/kk-workflow-stages.ts` into its owning plugin or a `kk` subcommand, together with its tests, and voice still calls it through the same `kk stage` name (thin delegate). Untouched voice-only stages stay.
- [x] R8. `mark-used` (`kk store mark-used --workflow kk-daily-ai-voice2 --run … --in <plan docs>`) runs after `publish-classify`. `ledger` (`kk ledger append`) is the final node.

### Acceptance Criteria

- [x] AC1 — kk-daily-ai-voice2 is a DAG that starts from the store
- [x] AC2 — Independent branches of the daily DAG run concurrently and fan in
- [x] AC3 — Empty pool ends the daily DAG as no-content, not failed
- [x] AC4 — Every DAG node is a single kk command with plugin-owned logic
- [x] AC5 — The safety revise loop runs as a nested state-machine sub-workflow
- [x] AC6 — Safety sub-workflow judge verdicts carry a HIGH, MEDIUM, or LOW confidence level

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



Additional declared surfaces: `apps/cli/tests/commands/**` (R7 moves stages into `kk` subcommands, and the repo rule `require-corresponding-test` requires a mirrored test for every new command module) and `apps/cli/tests/main.test.ts` (the `kk --help` visible-command list gains any new first-layer noun). G11 R9 (AC6) is the owning criterion for the voice2 judge/safety confidence levels; G31 R14 covers kk-collect only, so do not duplicate that work here.

### Plan

- [x] Failure-first list (empty pool, one branch fails, soft channel fails, safety block, revise bound hit, pause/resume of the operator review, publish disabled, sub-workflow binary missing).
- [x] `kk-daily-safety.yaml` from the current safety states; validate; run it on a fixture script dir.
- [x] voice2 node map; validate; dry run with `publish_enabled=false`.
- [x] Move touched stages into plugins / kk subcommands with their tests.
- [x] E2E `apps/cli/tests/voice2-dag.test.ts`, with stub agent nodes via a fake executor and a seeded store:
  - assert wall time ≈ the slowest branch for the article/cover/script wave;
  - publish-classify waits for all leaves;
  - an empty store gives a run that is done, with the ledger reading no-content.

  Copy the traces and ledger to `.works/test-artifacts/0211/`.
- [x] `docs/04_DESIGN.md` + satellite §6 sync; `bun run gate`.
- [x] Safety sub-workflow judge verdicts carry HIGH|MEDIUM|LOW (AC6): read the confidence from the verdict in the revise loop and in the draft-admission gate through the shared confidence-aware filter, and prove with fixtures that a missing/out-of-enum level is refused, named, and never deadlocks the loop (pattern: plugins/kk/tests/verdict-confidence.test.ts).

### Solution

**R7 landed (852f5b0c, c8ab8179 on sp/0211-daily-voice2).** The 24 voice2-touched `daily-*` stage bodies moved out of the runner into a plugin-owned sibling `plugins/kk/scripts/daily-stages.ts`, loaded lazily by the runner's `kk stage <name>` dispatcher (itc-stages.ts precedent — same `kk stage` surface, plugin-shippable bodies). 57 shared helpers are exported from `plugins/kk/scripts/kk-workflow-stages.ts:1` region for the sibling's destructured imports (lazy-load cycle is ESM-safe; biome has no noImportCycles here). The 6 old-voice-only stages (dailyPrepare, dailyCollectFacts, dailyPublishClassify→`kk daily`, dailyPublishPartial, dailyPatchSurfdash, dailyRunReport) stay in the runner until `kk-daily-ai-voice.yaml` retires (design §8).

Tension recorded: destination is `plugins/kk/scripts/` (capability scripts), not a product plugin kind dir — stage logic is agent-capability-adjacent; revisit if a `scripts` kind ever formalizes.

Codemod lessons (applied in /tmp/stages-apply3.ts): export-prefix must land on the decl line, not an absorbed comment start (`export //` is invalid and biome strips it); rebuild-from-HEAD ground truth caught a stale pre-rebase input early. Gate compliance fixes rode along as c8ab8179: store.ts countPoolItems via FileSystem seam (`apps/cli/src/commands/store.ts:31` region), daily.ts bound-local parse bindings (`apps/cli/src/commands/daily.ts:100` region), sync-structural daily.ts added to `.spur/rules/strict/runtime-boundaries.yaml` allowlist (same class as stage.ts), coverage restored by `apps/cli/tests/commands/daily.test.ts:281` region (works-dir resolution incl. corrupt-config fallthrough, run-report no-candidates/cached paths, malformed-targets fold).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:2` `kind: dag`; shape asserted at `apps/cli/tests/voice2-dag.test.ts:398-420`; voice1 guard at `apps/cli/tests/voice2-dag.test.ts:642-656` (byte-identity relaxed to behavioural identity by 0257, docs-only edits) |
| R2 | MET | Head chain `prepare` / `read-work-dir` / `read-run-date` / `extract` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:106-189`; single-node waves, only two `file.read.into-var` readers, no collect/ingest/label asserted at `apps/cli/tests/voice2-dag.test.ts:398-420` (`--exclude-used` later removed by 0228 R6c, asserted at `apps/cli/tests/voice2-dag.test.ts:415-416`) |
| R3 | MET | One action per node, only kk / agent.run / file.read.into-var / the safety `spur workflow run`, asserted at `apps/cli/tests/voice2-dag.test.ts:440-456`; safety shell at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:484-505` |
| R4 | MET | `plugins/kk/workflows/kk-daily-safety.yaml:4` `kind: state-machine` bounded by `safety_max_revise` (`plugins/kk/workflows/kk-daily-safety.yaml:33`); voice2 `safety` node `plugins/kk/workflows/kk-daily-ai-voice2.yaml:484-505`, `review` pause node `plugins/kk/workflows/kk-daily-ai-voice2.yaml:506-512`; asserted at `apps/cli/tests/voice2-dag.test.ts:559-568` and `apps/cli/tests/voice2-dag.test.ts:704-711` |
| R5 | MET | Fan-out guard `kk store pool-count … pool.json --min 1` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:200`; `run-report` dependsOn `extract` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:822`; asserted at `apps/cli/tests/voice2-dag.test.ts:458-495` and empty-pool run at `apps/cli/tests/voice2-dag.test.ts:978-1010` |
| R6 | MET | `publish-classify` fans in every publish leaf with `dependencyPolicy: all` and the `publish_enabled` skip at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:776-794`; asserted at `apps/cli/tests/voice2-dag.test.ts:497-521` |
| R7 | MET | `daily-*` stage bodies live in `plugins/kk/scripts/daily-stages.ts`, lazily loaded by `loadDailyStages` at `plugins/kk/scripts/kk-workflow-stages.ts:134-146`; stage tests green in the full suite this run |
| R8 | MET | `mark-used` renamed `mark-published` by 0228 R2/R6b, still after `publish-classify` (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:796-815`); `ledger` is the final node (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:833`); asserted at `apps/cli/tests/voice2-dag.test.ts:538-556` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — kk-daily-ai-voice2 is a DAG that starts from the store | MET | test | `apps/cli/tests/voice2-dag.test.ts:398-420` |
| R2 — Independent branches of the daily DAG run concurrently and fan in | MET | test | `apps/cli/tests/voice2-dag.test.ts:1012-1050` (real spur DAG run, overlap + fan-in ordering) |
| R3 — Empty pool ends the daily DAG as no-content, not failed | MET | test | `apps/cli/tests/voice2-dag.test.ts:977-1010` |
| R4 — Every DAG node is a single kk command with plugin-owned logic | MET | test | `apps/cli/tests/voice2-dag.test.ts:440-456` |
| R5 — The safety revise loop runs as a nested state-machine sub-workflow | MET | test | `apps/cli/tests/voice2-dag.test.ts:559-568` + `apps/cli/tests/voice2-dag.test.ts:704-711` |
| R9 — Safety sub-workflow judge verdicts carry a HIGH, MEDIUM, or LOW confidence level | MET | test | `apps/cli/tests/voice2-dag.test.ts:658-819` + `plugins/kk/tests/verdict-confidence.test.ts:642-670` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

- **Parked partial:** branch `sp/wip-0211-partial-20261007-202740` (commit `ebd38fb7`, "chore(0211): park the partial 0211 implementation (UNVERIFIED, R7 incomplete)") holds the implement dispatch that died on a provider error 2026-10-07 after 58 min. Produces validating `kk-daily-ai-voice2.yaml` + `kk-daily-safety.yaml`, the `kk daily` noun module, tests, and cli/ledger/store edits — but R7 (plugin-owned stages in `kk-workflow-stages.ts`) is NOT done and nothing is verified.
- **Resume path:** branch is based on `7552b050` (task 0213), 17 commits behind main — rebase onto main (expect conflicts in `cli.ts`/`ledger.ts`/`store.ts`), finish R7, then run the pipeline. Do not merge the branch as-is: it is uncertified by design.
- **Recovery notes (gitignored):** `.spur/run/4606d18a-5223-46e1-9d8d-d8887db48807-implement-partial.md`; `/Users/robin/.pi/agent/checkpoints/g31-runall-checkpoint.md`.

### History

- 2026-10-07T23:28:13.920Z todo → wip (system)
- 2026-10-07T23:28:14.896Z wip → testing (system)
- 2026-10-07T23:33:58.876Z testing → done (system)

