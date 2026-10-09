---
schema_version: 1
name: "kk-daily-ai-voice2: every agent.run node exits 0 without writing its expected file, so each daily run ends failed"
status: testing
template: issue
created_at: 2026-10-09T17:05:14.052Z
updated_at: "2026-10-09T19:39:05.663Z"
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

- [x] R1. (Diagnosis — done at refine, see Root Cause.) The violator for the missing-artifact failure is
  the resolved executor, not the node contract. Do not rewrite the node prompts or `expectFile` paths.
- [x] R2. Add one bounded recovery attempt for each hard-fail `agent.run` node (`plan-translate`,
  `article-write`): the primary node becomes `onError: continue`; a sibling `<id>-retry` node runs only
  when the primary's `expectFile` is missing or empty, uses the same `input`/`expectFile`, resolves its
  executor from `${vars.agent_retry}` with `role: coder` (a different tier than the primary's
  `scribe`), and has **no** `onError` — so a second miss fails the run loudly.
- [x] R3. Add the missing edges: every node that reads `21-plan/<date>_03_plan_plan.json`
  (`article-write`, `cover-brief`, `script-write`) depends on `[plan-translate, plan-translate-retry]`;
  `article` depends on both write nodes and both retries. Keep the existing `qc-content` edge where the
  comment at `:237-241` relies on it. Keep declaration order topological (`:78-82`).
- [x] R4. Keep the contract failure loud: an `agent.run` that exits 0 without its `expectFile` still
  fails its node and preserves the `-partial.md` sidecar (spur's existing behaviour — assert it, don't
  re-implement it).
- [x] R5. Blast radius recorded: `cover-brief`, `script-write`, `xhs-write` stay `onError: continue`
  (soft by design, no retry); `translate` (`:582-600`) has no `expectFile` and is out of scope.
- [ ] R6. Prove it end-to-end with the existing DAG harness (`apps/cli/tests/voice2-dag.test.ts`) and
  one live dry run.

### Acceptance Criteria

- [x] AC1 — Given a voice2 DAG run where the `plan-translate` executor exits 0 without writing its `expectFile`, when the run continues, then `plan-translate-retry` runs, writes the file, and the run reaches `done` (evidence: new case in `apps/cli/tests/voice2-dag.test.ts` with a fake executor that no-ops on the first call).
- [x] AC2 — Given both `plan-translate` and `plan-translate-retry` exit 0 without the file, then the run ends `failed` at `plan-translate-retry` and both `-partial.md` sidecars exist (same harness).
- [x] AC3 — Given `plan-translate` succeeds, then `plan-translate-retry` is `skipped` and `article-write`, `cover-brief`, `script-write` still run (done+skipped mix) — evidence: harness asserts node states.
- [x] AC4 — `article-write`, `cover-brief` and `script-write` never start before `plan-translate` settles — evidence: harness asserts start order from the run trace, and `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice2.yaml` passes.
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

**Chosen shape: a `-retry` sibling node plus the missing dependency edges — YAML only, no engine or kk
code change.**

| Change | Location | Rationale |
| --- | --- | --- |
| New var `agent_retry: "inline"` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:64` | R2: the retry must resolve on a *different tier* from `vars.agent` so a broken cheap executor cannot fail twice. `inline` keeps the same resolution ladder by default; the operator may pin a known-good executor. |
| `plan-translate` gains `onError: continue`; its prompt is anchored `&plan-translate-input` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:211,220` | R2: a stochastic executor no-op must not end the run at the primary — the sibling decides. The anchor makes the two attempts share one byte-identical prompt. |
| New node `plan-translate-retry`, `dependsOn: [plan-translate]`, guard `! test -s <expectFile>`, `role: coder`, `agent: ${vars.agent_retry}`, `input: *plan-translate-input`, **no `onError`** | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:227-247` | R2: runs only when the primary settled without its file; a second miss fails the run loudly. The `-s` (not `-f`) test also covers a truncated/empty write, which is the same contract violation. |
| Same pair for `article-write` / `article-write-retry` with its own anchor | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:261,270,278-298` | R2. Prompt anchored identically so the two article attempts cannot drift. |
| `article-write` → `[qc-content, plan-translate, plan-translate-retry]` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:251` | R3: it reads `21-plan/<date>_03_plan_plan.json`. `qc-content` stays first so the done+skipped mix keeps this node runnable when the plan producers are disabled (all-skipped deps skip a node). |
| `cover-brief` → `[qc-content, plan-translate, plan-translate-retry]` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:326-329` | R3: same file reader, same `qc-content` retention. |
| `script-write` → `[script-style, plan-translate, plan-translate-retry]` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:388-391` | R3: same file reader; `script-style` stays first so the node remains runnable when the plan producers are disabled. |
| `article` → `[qc-content, plan-translate, plan-translate-retry, article-write, article-write-retry]` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:302` | R3: it consumes both write nodes and must not start before either retry settles. |
| Header comment records the retry policy next to the fail-fast paragraph | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:88-90` | Keeps the file's own contract statement true: `onError: continue` now sits in two more places, by design. |
| Node map + a retry bullet in the owning design doc | `docs/design/kk-collect-and-daily-voice2.md:216-221,243` | T3: the surface (node set, edges) changed in this commit. |

**Contract left alone (R4/R5).** `agent.run` exiting 0 without its `expectFile` still fails its node
and still preserves `.spur/run/<runId>-<node>-partial.md` — asserted by the AC1/AC2 harness, not
re-implemented. `cover-brief`, `script-write`, `xhs-write` keep `onError: continue` with no retry
(soft by design); `translate` has no `expectFile` and is out of scope.

Rejected: pinning `vars.agent` to a measured executor (the executors in `~/.config/spur/config.yaml`
churn, so the pin would rot, and it does not fix the race); making every node `onError: continue` (a
run with no translated plan would publish garbage); fixing the prompt (the prompt names the path and
other executors write it — the no-op is the executor ignoring a valid instruction).

Ceiling (`shortcut:`): one retry, not N — no escalation ladder, no backoff. Upgrade when a second
attempt is observed failing on an executor that a third would pass. The upstream fix (an `agent.run`
retry on a missing `expectFile`) is filed as a spur ask; when it ships, delete both `-retry` nodes.

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Diagnosis accepted as refined: the violator is the resolved executor, not the node contract. The node prompt and `expectFile` agree at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:220-222` and `:270-272`, and the probe run confirmed the engine's own contract failure text — `agent.run (coder) exited 0 but expected file is absent … executor contract failure preserved at .spur/run/<runId>-<node>-partial.md`. No prompt or `expectFile` path was rewritten by this change. |
| R2 | MET | `plan-translate` and `article-write` now carry `onError: continue` (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:211,261`) and a `-retry` sibling on a different tier — `role: coder`, `agent: ${vars.agent_retry}` (`:242,293`), same `input` (YAML anchor) and `expectFile`, **no** `onError`. Asserted by `apps/cli/tests/voice2-dag.test.ts` AC1 (primary no-op → retry writes → run `done`), AC2 (both no-op → run `failed`, both sidecars), and the structural case that diffs `input`/`expectFile`/`role` across each pair. |
| R3 | MET | `article-write` → `[qc-content, plan-translate, plan-translate-retry]` (`:251`), `cover-brief` → `[qc-content, plan-translate, plan-translate-retry]` (`:326-329`), `script-write` → `[script-style, plan-translate, plan-translate-retry]` (`:388-391`), `article` → `[qc-content, plan-translate, plan-translate-retry, article-write, article-write-retry]` (`:302`). `qc-content` / `script-style` are kept first so a disabled producer cannot strand the dependent. Declaration order stays topological and `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice2.yaml` exits 0; asserted both structurally and by observed start order in `apps/cli/tests/voice2-dag.test.ts` AC4. |
| R4 | MET | The contract failure is still loud and the sidecar is still preserved by spur's own code — asserted, not re-implemented: `apps/cli/tests/voice2-dag.test.ts` AC1 asserts the primary's `.spur/run/<runId>-plan-translate-partial.md` exists, AC2 asserts it for both attempts. |
| R5 | MET | Blast radius recorded in the Solution: `cover-brief`, `script-write` and `xhs-write` keep `onError: continue` with no retry (soft by design), and `translate` has no `expectFile` and is untouched. Confirmed by `plugins/kk/workflows/kk-daily-ai-voice2.yaml:336,397,592` and the absence of any retry sibling for those nodes. |
| R6 | PARTIAL | Harness half done: `apps/cli/tests/voice2-dag.test.ts` AC1–AC4 pass against real `agent.run` dispatch on stub executors. Live half NOT RUN — the daily pool is empty, so a voice2 dry run ends `no-content` before reaching `plan-translate` / `article-write` (see Acceptance Criteria AC5). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/voice2-dag.test.ts` — `agent=pi` (no-op) + `agent_retry=claude` (writes): stub order `['pi','claude']`, run status `done`, `21-plan/20261007_03_plan_plan.json` on disk, primary `-partial.md` present and retry `-partial.md` absent. |
| AC2 | MET | test | `apps/cli/tests/voice2-dag.test.ts` — both agents no-op: run status `failed` and both `voice2-retry-both-noop-plan-translate-partial.md` and `voice2-retry-both-noop-plan-translate-retry-partial.md` exist. |
| AC3 | MET | test | `apps/cli/tests/voice2-dag.test.ts` — with both producers enabled and writable, the run is `done`, `plan-translate` has a trace action event, `plan-translate-retry` has none (skipped), and `article-write`, `cover-brief`, `script-write` all dispatched. |
| AC4 | MET | test | `apps/cli/tests/voice2-dag.test.ts` — each of `article-write`, `cover-brief`, `script-write` has a trace `startedAt` at or after `plan-translate.completedAt`; `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice2.yaml` exits 0; the declared `dependsOn` sets contain both plan producers and `article` contains all four producer/retry edges. |
| AC5 | PARTIAL | command | NOT RUN, blocked by the environment rather than by the change: `kk store extract --topic ai-news --window 24h` returns `{"count":0}` against the live store (92 `items`, 12 `selections` rows), so the run ends `no-content` before reaching the two nodes this change touches. Operator decision 2026-10-09: defer rather than spend executor + TTS budget on a run that cannot reach the code path. Unblock: refresh the pool, or `kk store release --run <id>`, then `spur workflow run plugins/kk/workflows/kk-daily-ai-voice2.yaml` with `publish_enabled=false`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

**Gate re-run on the integrated tree (final evidence).** The batch branch was rebased onto `main`
(`e75232ff`) after the two commits, because `main` advanced while this batch ran — so the numbers above
(from the pre-rebase base) are superseded. On the rebased tree, whose diff against `main` is exactly
this batch's 9 files:

```
bun run gate        # format + build + lint + typecheck + rules + tests    exit 0
  Checked 401 files in 379ms. No fixes applied.        (biome)
  2355 pass, 2 skip, 0 fail                            (full suite)
```

`git diff --stat main` = 1267 insertions / 91 deletions across 9 files, all owned by 0237 and 0238.

### Review

**Disposition: PASS with one open acceptance criterion (AC5, environment-blocked).**

| Priority | Finding | Location | Action |
| --- | --- | --- | --- |
| P1 | — none — | | |
| P2 | — none — | | |
| P3 | The retry doubles the node count for the two hard-fail producers, and the prompt is duplicated per pair via a YAML anchor. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:220,270` | Accepted: the anchor is what keeps the two attempts byte-identical, which is the design's stated invariant, and the harness asserts the equality. Delete both pairs when spur grows an `agent.run` retry. |
| P3 | The retry guard re-states the primary's condition (`pool-count` + the `*_enabled` test) before adding `! test -s <expectFile>`. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:235-238,286-289` | Deliberate redundancy: without it the guard would run `test -s` on a workspace the pool guard already rejected. Cheap and keeps each guard self-describing. |
| P3 | `role: coder` is a *tier* choice, not a behavioural one — the retry gets the same prompt and the same tools. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:242,293` | Correct for the failure mode (a cheap-tier executor answering without acting). If a future failure is instead prompt-shaped, a tier swap will not help — watch for that in the live run. |
| P4 | The AC1–AC4 harness needed new `RunOutcome.agentLog` plumbing and a stub writer in the shared test file. | `apps/cli/tests/voice2-dag.test.ts:203,271,345` | Accepted; it is the smallest way to exercise real `agent.run` dispatch, and it is reusable by the next DAG test. |

Residual risk: the retry is only ever *one* extra attempt, and both siblings share a single condition
— a run whose primary and retry both no-op fails, which is the intended loud ending, but it also means
a transiently broken executor pair still ends a daily run. AC5's live dry run is the outstanding
evidence and is recorded as blocked in Testing.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-09T19:34:39.471Z todo → wip (system)
- 2026-10-09T19:34:39.815Z wip → testing (system)

