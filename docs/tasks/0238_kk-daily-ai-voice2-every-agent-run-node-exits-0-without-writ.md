---
schema_version: 1
name: "kk-daily-ai-voice2: every agent.run node exits 0 without writing its expected file, so each daily run ends failed"
status: todo
template: issue
created_at: 2026-10-09T17:05:14.052Z
updated_at: "2026-10-09T18:10:31.926Z"
feature_id: G11

priority: P1
ac_altitude: task-local
---

## 0238. kk-daily-ai-voice2: every agent.run node exits 0 without writing its expected file, so each daily run ends failed

### Background

Found during the G32 batch's live dogfood of `kk-daily-ai-voice2` (task 0230): dry runs ended `failed`
at an `agent.run` node after `select` had committed its rows.

**Re-verified 2026-10-09 (refine pass) — the title overstates the defect.** The original evidence
(`.works/test-artifacts/g32/voice2-run1.log`, run 82388632) no longer exists on disk; the live ledger and
`.spur/run/*-partial.md` sidecars show two distinct defects, neither "every node, every run":

1. **Intermittent executor no-op (stochastic, executor-dependent).** The node contract is correct — the
   `input` names the output path and `expectFile` matches it (`kk-daily-ai-voice2.yaml:185-208`). The
   violator is the resolved executor: `.spur/run/c208b450-…-plan-translate-partial.md` and its session
   JSONL show `pi -p … --model deepseek/deepseek-v4-flash` receiving the full prompt and replying
   "I'm ready to help! What would you like to work on?" with zero tool calls; ledger run a0335f44 shows
   `plan-translate`, `article-write`, `script-write` all "exited with code 3" under agy. Other runs
   (38e53162 done, 5c176a90 / 2a4be93d agent nodes ok) pass with the same YAML. voice1 shows the same
   class. `vars.agent: "inline"` (`:60`) resolves on headless surfaces to a role/tier executor from
   `~/.config/spur/config.yaml`, which the operator enables/disables frequently — so which executor
   answers is not stable.
2. **Missing dependency edges (deterministic race).** `plan-translate` writes
   `21-plan/<date>_03_plan_plan.json`, but three readers of that file do not depend on it:
   `article-write` (`dependsOn: [qc-content]`, `:212`; reads it at `:227`), `cover-brief`
   (`dependsOn: [qc-content]`, `:257`; reads it at `:275`) and `script-write` (via
   `script-style → qc-content`, `:303`/`:317`; reads it at `:333`). The engine dispatches a whole wave
   once its deps settle (`:84-87`), so all four run in the same wave. Observed: run 5c176a90's
   `article-write` session (`.spur/run/5c176a90-…/agent-sessions/coder/fresh-article-write/*.jsonl`,
   00:33:13Z) got `ENOENT` reading the plan json; the file's mtime is 17:54:25 PDT (00:54Z) — written
   21 minutes later. `xhs-write` is safe (`script → article → plan-translate`).

**Consequence.** (1) fails the run (`plan-translate`, `article-write` are hard-fail) while
`selections` stay committed (0228), so the pool advances behind a failed job. (2) silently degrades
output: article prose, cover subject and script plan are authored without the translated plan (or from
a stale same-date file) and the run can still report `done`.

**Not caused by store-v2.** `.works/test-artifacts/0211/voice2-concurrent-calls.log` predates it.
**Out of scope:** history workflows' enrich/validate empty-stdout failures (same executor class, other
DAGs) — noted for a follow-up, not fixed here.

### Requirements

- [ ] R1. (Diagnosis — done at refine, see Root Cause.) The violator for the missing-artifact failure is
  the resolved executor, not the node contract. Do not rewrite the node prompts or `expectFile` paths.
- [ ] R2. Add one bounded recovery attempt for each hard-fail `agent.run` node (`plan-translate`,
  `article-write`): the primary node becomes `onError: continue`; a sibling `<id>-retry` node runs only
  when the primary's `expectFile` is missing or empty, uses the same `input`/`expectFile`, resolves its
  executor from `${vars.agent_retry}` with `role: coder` (a different tier than the primary's
  `scribe`), and has **no** `onError` — so a second miss fails the run loudly.
- [ ] R3. Add the missing edges: every node that reads `21-plan/<date>_03_plan_plan.json`
  (`article-write`, `cover-brief`, `script-write`) depends on `[plan-translate, plan-translate-retry]`;
  `article` depends on both write nodes and both retries. Keep the existing `qc-content` edge where the
  comment at `:237-241` relies on it. Keep declaration order topological (`:78-82`).
- [ ] R4. Keep the contract failure loud: an `agent.run` that exits 0 without its `expectFile` still
  fails its node and preserves the `-partial.md` sidecar (spur's existing behaviour — assert it, don't
  re-implement it).
- [ ] R5. Blast radius recorded: `cover-brief`, `script-write`, `xhs-write` stay `onError: continue`
  (soft by design, no retry); `translate` (`:582-600`) has no `expectFile` and is out of scope.
- [ ] R6. Prove it end-to-end with the existing DAG harness (`apps/cli/tests/voice2-dag.test.ts`) and
  one live dry run.

### Acceptance Criteria

- [ ] AC1 — Given a voice2 DAG run where the `plan-translate` executor exits 0 without writing its `expectFile`, when the run continues, then `plan-translate-retry` runs, writes the file, and the run reaches `done` (evidence: new case in `apps/cli/tests/voice2-dag.test.ts` with a fake executor that no-ops on the first call).
- [ ] AC2 — Given both `plan-translate` and `plan-translate-retry` exit 0 without the file, then the run ends `failed` at `plan-translate-retry` and both `-partial.md` sidecars exist (same harness).
- [ ] AC3 — Given `plan-translate` succeeds, then `plan-translate-retry` is `skipped` and `article-write`, `cover-brief`, `script-write` still run (done+skipped mix) — evidence: harness asserts node states.
- [ ] AC4 — `article-write`, `cover-brief` and `script-write` never start before `plan-translate` settles — evidence: harness asserts start order from the run trace, and `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice2.yaml` passes.
- [ ] AC5 — One live dry run (`publish_enabled=false`) reaches `done` with every declared `expectFile` present; ledger row and run id recorded in Testing.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-09T18:10:31.925Z

- **Q: Is "every agent.run node, every run" true?** No — intermittent and executor-dependent (ledger:
  38e53162 done; a0335f44 three nodes exit 3; c208b450 deepseek greeting). Title kept for traceability;
  Background states the corrected scope.
- **Q: Fix the prompt instead?** No — prompts name the path and other executors write it; the no-op is
  the executor ignoring a valid instruction.
- **Q: Why `role: coder` on the retry?** Global config maps scribe→cheap, coder→standard; the retry
  should hit a different tier so a broken cheap executor doesn't fail twice.
- **Q: Why not retry soft nodes (`cover-brief`, `script-write`, `xhs-write`)?** They already degrade to
  templates/defaults by design; adding retries there is scope creep.

### Design

**Chosen: retry-sibling node + dependency edges, YAML-only** (no engine or kk code change).

```yaml
- id: plan-translate          # existing; add onError: continue
  action: { kind: agent.run, onError: continue, options: { …unchanged… } }
- id: plan-translate-retry
  dependsOn: [plan-translate]
  condition:
    kind: shell
    options:
      command: >-
        kk store pool-count "<candidates.json>" --min 1
        && ! test -s "${vars.work_dir}/21-plan/${vars.run_date}_03_plan_plan.json"
  action:
    kind: agent.run            # no onError → hard-fail on a second miss
    options: { role: coder, agent: ${vars.agent_retry}, input: <same>, expectFile: <same> }
```

Same pair for `article-write`. New var `agent_retry: "inline"` (operator may pin a known-good executor).
Downstream readers depend on `[plan-translate, plan-translate-retry]`: when the primary succeeds the retry
is `skipped` and the done+skipped mix proceeds (`:74-76`); when it fails-continue the retry is the gate.

Rejected:
- **Pin `vars.agent`** to a measured executor — executors in `~/.config/spur/config.yaml` churn; the
  pin would rot and doesn't fix the race.
- **Upstream spur `agent.run` retry on missing `expectFile`** — the right long-term fix; file as a
  spur ask, but it is not in-repo and blocks nothing here. When it ships, delete the `-retry` nodes.
- **Make every node `onError: continue`** — a run with no translated plan would publish garbage.

Ceiling (`ponytail:`): one retry, not N; duplicated `input` text between primary and retry — keep the
two blocks byte-identical (AC harness can diff them).

### Plan

1. Confirm engine semantics before editing (5 min): a node with `onError: continue` that fails counts
   as settled for its dependents — check `cover-brief → cover` in a recent run trace or spur docs
   (`spur workflow --help` / `sp:spur-cli`). If it does not, stop and re-plan.
2. Extend `apps/cli/tests/voice2-dag.test.ts` first (AC1–AC4): fake executor that no-ops on call N;
   assert node states and start order. Run — must fail on current YAML.
3. Edit `plugins/kk/workflows/kk-daily-ai-voice2.yaml`: `vars.agent_retry`; `onError: continue` on
   `plan-translate` and `article-write`; add `plan-translate-retry` and `article-write-retry` right after
   their primaries; fix `dependsOn` for `article-write`, `cover-brief`, `script-style`/`script-write`,
   `article`; keep topological order.
4. `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice2.yaml`; `bun test apps/cli/tests/voice2-dag.test.ts`.
5. Update `docs/04_DESIGN.md` voice2 node table (T3) and the YAML header comment.
6. `bun run gate` — **only after 0242 R6 lands or from a worktree**, because the test suite currently
   migrates the live `.works/kk.db` (0242).
7. Live dry run (AC5); record run id + ledger row in Testing.
8. File the spur upstream ask (agent.run retry on missing `expectFile`) and link it in References.

### Root Cause

Two independent causes (refine-pass verification, 2026-10-09):

1. **Executor no-op, no recovery path** — HIGH. The node prompt and `expectFile` agree
   (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:206-207`, `:232-233`). The executor sometimes answers
   without acting (pi/deepseek-v4-flash greeting, `.spur/run/c208b450-…-plan-translate-partial.md`) or
   exits 3 (agy, ledger run a0335f44). spur's `agent.run` correctly fails the node (R4 property), but
   the workflow has no second attempt: `onError` accepts only `fail|continue` and there is no engine
   retry, and `plan-translate` / `article-write` carry no `onError`, so one stochastic no-op fails the
   run.
2. **Missing `dependsOn` edges** — HIGH. `article-write` (`:212`), `cover-brief` (`:257`) and
   `script-style`→`script-write` (`:303`, `:317`) depend only on `qc-content` but read
   `_03_plan_plan.json`, which only `plan-translate` (`:185-208`) writes. Same wave ⇒ readers can run
   before the writer (run 5c176a90: ENOENT at 00:33:13Z, file written 00:54:25Z).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
