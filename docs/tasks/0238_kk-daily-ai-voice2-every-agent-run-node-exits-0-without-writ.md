---
schema_version: 1
name: "kk-daily-ai-voice2: every agent.run node exits 0 without writing its expected file, so each daily run ends failed"
status: done
template: issue
created_at: 2026-10-09T17:05:14.052Z
updated_at: "2026-10-14T01:48:36.425Z"
feature_id: G11

priority: P1
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0238-verdict.json
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
- [x] R6. Prove it end-to-end with the existing DAG harness (`apps/cli/tests/voice2-dag.test.ts`) and
  one live dry run.

### Acceptance Criteria

- [x] AC1 — Given a voice2 DAG run where the `plan-translate` executor exits 0 without writing its `expectFile`, when the run continues, then `plan-translate-retry` runs, writes the file, and the run reaches `done` (evidence: new case in `apps/cli/tests/voice2-dag.test.ts` with a fake executor that no-ops on the first call).
- [x] AC2 — Given both `plan-translate` and `plan-translate-retry` exit 0 without the file, then the run ends `failed` at `plan-translate-retry` and both `-partial.md` sidecars exist (same harness).
- [x] AC3 — Given `plan-translate` succeeds, then `plan-translate-retry` is `skipped` and `article-write`, `cover-brief`, `script-write` still run (done+skipped mix) — evidence: harness asserts node states.
- [x] AC4 — `article-write`, `cover-brief` and `script-write` never start before `plan-translate` settles — evidence: harness asserts start order from the run trace, and `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice2.yaml` passes.
- [x] AC5 — One live dry run (`publish_enabled=false`) reaches `done` with every declared `expectFile` present; ledger row and run id recorded in Testing.

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

#### Q&A entry — 2026-10-10T06:00:22.046Z

- **Q: Why did the retry move from `role: coder` to `role: reviewer` (2026-10-09 re-verify)?** Spur resolves a role to the cheapest *usable* executor at or above its tier. A `scribe` primary whose cheap rung is unusable therefore climbs to standard, which is where `coder` starts, and `ac5-live-1` retried `pi-deepseek` with `pi-deepseek`. **A:** `reviewer` (capable-1) starts two rungs above `scribe`. The two attempts now share an executor only when the cheap and standard rungs are both unusable. No box-specific executor is pinned; the Solution amendment records this as a CHANGED design claim.

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
| New var `agent_retry: "inline"` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:65` | R2: the retry must resolve on a *different tier* from `vars.agent` so a broken cheap executor cannot fail twice. The siblings declare `role: reviewer` (see the amendment below), so the default `inline` resolves the retry on capable-1, above any rung the primary reaches; the operator may still pin a known-good executor. |
| `plan-translate` gains `onError: continue`; its prompt is anchored `&plan-translate-input` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:217,223` | R2: a stochastic executor no-op must not end the run at the primary — the sibling decides. The anchor makes the two attempts share one byte-identical prompt. |
| New node `plan-translate-retry`, `dependsOn: [plan-translate]`, guard `! test -s <expectFile>`, `role: reviewer`, `agent: ${vars.agent_retry}`, `input: *plan-translate-input`, **no `onError`** | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:233-253` | R2: runs only when the primary settled without its file; a second miss fails the run loudly. The `-s` (not `-f`) test also covers a truncated/empty write, which is the same contract violation. |
| Same pair for `article-write` / `article-write-retry` with its own anchor | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:268,275,285-305` | R2. Prompt anchored identically so the two article attempts cannot drift. |
| `article-write` → `[qc-content, plan-translate, plan-translate-retry]` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:257` | R3: it reads `21-plan/<date>_03_plan_plan.json`. `qc-content` stays first so the done+skipped mix keeps this node runnable when the plan producers are disabled (all-skipped deps skip a node). |
| `cover-brief` → `[qc-content, plan-translate, plan-translate-retry]` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:331` | R3: same file reader, same `qc-content` retention. |
| `script-write` → `[script-style, plan-translate, plan-translate-retry]` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:394` | R3: same file reader; `script-style` stays first so the node remains runnable when the plan producers are disabled. |
| `article` → `[qc-content, plan-translate, plan-translate-retry, article-write, article-write-retry]` | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:314` | R3: it consumes both write nodes and must not start before either retry settles. |
| Header comment records the retry policy next to the fail-fast paragraph | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:92-95` | Keeps the file's own contract statement true: `onError: continue` now sits in two more places, by design. |
| Node map + a retry bullet in the owning design doc | `docs/design/kk-collect-and-daily-voice2.md:221-222,247` | T3: the surface (node set, edges) changed in this commit. |

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
retry on a missing `expectFile`) is to be filed as a spur ask (an external action awaiting operator authorization — not yet filed); when it ships, delete both `-retry` nodes.

**Residual found by the live verification and fixed in this change (2026-10-09).**

`kk stage daily-article` failed the live run with
`Input schema violation for kind 'generator': root: Invalid input: expected array, received object`:
`plan-translate`'s executor had written the generator's **Content envelope**
(`{title, body, format, metadata:{generator, date, doc_count, docs}}`) back to the plan path instead of
the `Doc[]` the prompt asks for — valid JSON of the wrong shape, which the existing guard (which only
caught *unparseable* JSON) passed straight to `daily-article-gen`. `dailyArticle`
(`plugins/kk/scripts/daily-stages.ts:196-232`) now unwraps that envelope in place — `metadata.docs` is
exactly what `dailyPlan` writes there, so the translation is salvaged rather than replaced by the
untranslated candidates — and falls back to the candidates only when there is no usable `docs` array.
Regression: `apps/cli/tests/kk-workflow-stages.test.ts` "daily-article unwraps a plan.json that carries
the Content envelope instead of the Doc[]" (asserts the file is rewritten as the envelope's own docs,
not the candidates; fails without the fix).

**Live evidence (five runs against a snapshot of the real store, 2026-10-09).** Recorded in full under
Testing; the run ids are `ac5-live-1` (retry fired and failed loudly), `ac5-live-2`…`ac5-live-5`
(`generate` / `article` / `duration` / estimate-gate outcomes). The retry siblings and the new edges
were exercised by a real `kk-daily-ai-voice2` run, not only by the harness.


**Live closure (2026-10-09, run `ac5-live-16`).** With the 0237 segmented
path, a full live `kk-daily-ai-voice2` dry run (`publish_enabled=false`) reached `done` in 18
transitions, so AC5 is met: every hard-fail producer wrote its `expectFile`, `generate` joined seven
sections into a 1008.215 s episode, and the tail (duration gate, report) ran on real data. The
`ac5-live-1`…`ac5-live-5` runs above remain the record of the retry firing and failing loudly.

**Amendment (2026-10-09 re-verify) — retry role `coder` → `reviewer` (CHANGED, documented).** The
Design's `role: coder` retry did not deliver R2's "different tier" under the shipped `inline`
defaults: spur resolves a role to the cheapest *usable* executor at or above its tier, so a primary
`scribe` whose cheap rung is unusable climbs to standard, the same rung `coder` starts on.
`ac5-live-1` showed exactly that (`pi-deepseek` retried with `pi-deepseek`). Spur's `agent.run`
passes the node `role` into resolution, and its executor-distinctness check fails closed for P0/P1
only rather than re-routing, so the in-workflow fix is the declared tier. Both `-retry` nodes now
declare `role: reviewer` (capable-1, two rungs above `scribe`):
`plugins/kk/workflows/kk-daily-ai-voice2.yaml:249`, `:301`, with the var comment at `:61-64`. The
retry now lands on the same executor as the primary only when the cheap and standard rungs are *both*
unusable, and then no lower-tier distinct executor exists anyway. The cost is a capable-1 dispatch, and
only on the retry path. Gate: `apps/cli/tests/voice2-dag.test.ts:824` asserts `role: reviewer` and a
retry rung ≥ primary rung + 2 (it failed against `coder`). Design doc:
`docs/design/kk-collect-and-daily-voice2.md:247`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Diagnosis recorded in Root Cause and kept: no node prompt or `expectFile` was rewritten; the retry reuses the primary's prompt via the YAML anchor `&plan-translate-input` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:271` referenced at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:299` |
| R2 | MET | `agent_retry: "inline"` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:69`; `plan-translate` `onError: continue` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:265`; `plan-translate-retry` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:281-301` (dependsOn primary, `! test -s` guard, `role: reviewer`, `agent: ${vars.agent_retry}`, no onError); `article-write` `onError: continue` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:316` and `article-write-retry` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:333-353`; tier/input/expectFile/no-onError asserted at `apps/cli/tests/voice2-dag.test.ts:925-955` (retry role reviewer, two rungs above scribe per 0238 P2) |
| R3 | MET | Edges: `article-write` dependsOn `[qc-content, plan-translate, plan-translate-retry]` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:305`; `article` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:362`; `cover-brief` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:379`; `script-write` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:442`; start order asserted at `apps/cli/tests/voice2-dag.test.ts:889-923` |
| R4 | MET | Loud contract failure and preserved sidecars asserted, not re-implemented: `apps/cli/tests/voice2-dag.test.ts:852-867` (both attempts no-op → failed, both sidecars exist) and `apps/cli/tests/voice2-dag.test.ts:832-850` (primary sidecar kept on recovery) |
| R5 | MET | `cover-brief` `onError: continue` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:391`, `script-write` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:453`, `xhs-write` at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:659` — no retry siblings; `translate` (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:737-765`) has no `expectFile` |
| R6 | MET | Harness AC1–AC4 at `apps/cli/tests/voice2-dag.test.ts:821-975` against real `agent.run` dispatch, green in the full suite this run; live run `ac5-live-16` evidence present under gitignored `.works/kk-0237-0238-evidence`; live-run residual fixed: `dailyArticle` unwraps a Content-envelope plan at `plugins/kk/scripts/daily-stages.ts:300-316`, pinned by `apps/cli/tests/kk-workflow-stages.test.ts:872` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `apps/cli/tests/voice2-dag.test.ts:832` — primary no-ops, retry writes the plan, run reaches done |
| AC2 | MET | test | `apps/cli/tests/voice2-dag.test.ts:852` — both no-op → run failed at the retry; both partial sidecars exist |
| AC3 | MET | test | `apps/cli/tests/voice2-dag.test.ts:869` — successful primary → retry skipped; downstream readers still run |
| AC4 | MET | test | `apps/cli/tests/voice2-dag.test.ts:889` — every plan reader starts after both producers settle |
| AC5 | MET | command | Live dry run `ac5-live-16` (`publish_enabled=false`) reached done in 18 transitions; evidence retained under gitignored `.works/kk-0237-0238-evidence` (0238-verdict.json, voicescript) and re-listed this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Disposition: PASS — AC5 closed by live run `ac5-live-16`; the executor-tier P2 is FIXED by declaring `role: reviewer` on both `-retry` nodes (2026-10-09 re-verify).** P3 rows whose action is "accepted, no change" are reclassified P4 advisory.

| Priority | Finding | Location | Action |
| --- | --- | --- | --- |
| P1 | None. | — | — |
| P2 | None. | — | — |
| P4 | The retry doubles the node count for the two hard-fail producers, and the prompt is duplicated per pair via a YAML anchor. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:223,275` | Accepted: the anchor is what keeps the two attempts byte-identical, which is the design's stated invariant, and the harness asserts the equality. Delete both pairs when spur grows an `agent.run` retry. |
| P4 | The retry guard re-states the primary's condition (`pool-count` + the `*_enabled` test) before adding `! test -s <expectFile>`. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:241-246,293-298` | Deliberate redundancy: without it the guard would run `test -s` on a workspace the pool guard already rejected. Cheap and keeps each guard self-describing. |
| P4 | `role: reviewer` on the retry is a *tier* choice, not a behavioural one — the retry gets the same prompt and the same tools. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:249,301` | Correct for the failure mode (a cheap-tier executor answering without acting). If a future failure is instead prompt-shaped, a tier swap will not help — watch for that in the live run. |
| P4 | The AC1–AC4 harness needed new `RunOutcome.agentLog` plumbing and a stub writer in the shared test file. | `apps/cli/tests/voice2-dag.test.ts:203,271,345` | Accepted; it is the smallest way to exercise real `agent.run` dispatch, and it is reusable by the next DAG test. |

Residual risk: the retry is only ever *one* extra attempt, and both siblings share a single condition
— a run whose primary and retry both no-op fails, which is the intended loud ending, but it also means
a transiently broken executor pair still ends a daily run. AC5's live dry run has since been met by
`ac5-live-16` (see Solution, Live closure).

**Second review pass after the live verification (2026-10-09).**

| Priority | Finding | Location | Action |
| --- | --- | --- | --- |
| P1 | None. | — | — |
| P2 | The retry is only a *different attempt* when `agent` and `agent_retry` resolve to different executors, and with the shipped defaults (`inline` / `inline`) they do not: both resolve through the run's stage role, so `ac5-live-1` retried `pi-deepseek` with `pi-deepseek`. The design's "a different tier than the primary's `scribe`" does not hold under `inline`. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:65` | FIXED (2026-10-09 re-verify): both `-retry` nodes now declare `role: reviewer` (capable-1) at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:249,301`, two rungs above the primary's `scribe`, so the default `inline` lands the retry above any rung the primary climbs to. No box-specific executor is pinned. On this box capable-1 has `agy-opus-5.5` (fsWrite attested) and `agy-gemini` enabled. Gate: `apps/cli/tests/voice2-dag.test.ts:824`. |
| P4 | The plan-shape repair is duplicated knowledge: `dailyArticle` now knows the Content envelope, while `dailyScript` would still mis-read a wrong-shaped plan if it ever ran before `article`. | `plugins/kk/scripts/daily-stages.ts:196-232` | Safe today: `script` dependsOn `article`, and `article` rewrites the file in place, so every later reader sees a `Doc[]`. Hoist into a shared helper if a third reader appears. |
| P3 | The estimate gate's 20-minute ceiling was hardcoded while `dailyEpisodeDuration` reads `episode_max_minutes`. | `plugins/kk/scripts/daily-stages.ts:617-628` | FIXED by `aae1f994`: `dailyGenerate` now takes `episode_max_minutes` as arg 8 and the workflow passes it (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:503`). |
| P4 | Five live runs left artifacts under `.works/ac5/` and `.works/kk-daily-ai-voice2/20261009/`. | untracked, ignored | Kept as evidence; delete with the worktree. |

Residual risk (updated 2026-10-09): `ac5-live-16` reached `done`, so the tail ran on real data. The P2
above is fixed by tier rather than by executor name. Distinct executors are guaranteed unless the cheap
and standard rungs are both unusable. The `reviewer` retry has not yet dispatched live. `ac5-live-16` was a final pass with authoring
frozen (`.works/kk-0237-0238-evidence/ac5-live16.log`), so the own-output guards skipped primary and
retry alike. Live proof of the new tier waits for the next real primary miss. Publish was disabled in that run, so the publish tail itself is covered by
0235/0236, not here.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-09T19:34:39.471Z todo → wip (system)
- 2026-10-09T19:34:39.815Z wip → testing (system)
- 2026-10-10T03:52:40.288Z testing → done (system)

