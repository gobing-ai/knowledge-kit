---
schema_version: 1
name: "Reconcile daily-ai-voice qc.passed gating: yaml quality-control edge vs recorded warn-only decision"
status: done
template: issue
created_at: 2026-09-16T23:47:28.960Z
updated_at: "2026-09-17T01:04:07.810Z"

---

## 0140. Reconcile daily-ai-voice qc.passed gating: yaml quality-control edge vs recorded warn-only decision

### Background

Surfaced by the 0139 re-verification (2026-09-16, verdict PASS) as an out-of-scope consistency finding.

**Fact 1 — the yaml gates on `qc.passed`.** `plugins/kk/workflows/kk-daily-ai-voice.yaml:529,537` route
`quality-control → publish-prep` / `→ done` only when
`jq -r '.metadata.qc.passed // true' _11_generate_content.json` prints `true`; the fallthrough
`quality-control → failed` edge is `kind: always` (present since `ef56d492`, 2026-09-07). On paper, a run
whose generate audit says `passed:false` goes to `failed` and never publishes.

**Fact 2 — the recorded operator decision is warn-only.** Task 0139 Q&A (entry 2026-09-16T19:08, CLOSED):
on `qc.passed:false`, publish proceeds and the run report carries the R5b QC block; rationale — R5a's
repetition hard-fail already stops the credibility-damaging class, and blocking on degradation-class
audits (loudness dips, transcription fidelity) would stall the daily feed.

**Fact 3 — observed behavior matched warn-only.** The 2026-09-16 dogfood (`.works/kk-daily-ai-voice/2026-09-16/`)
published verdict `full` with `passed:false` on disk — step-timing shows
`generate → quality-control → publish-prep → … → publish`, so the edge did NOT fire in practice
(mechanism undetermined: stale installed workflow file, guard evaluation order, or manual advance).

The Q&A record and the yaml text disagree; the next degradation-class `passed:false` run will resolve
the ambiguity one way or the other — decide which behavior is intended before that happens.

**Premise verification (ready-depth refine, 2026-09-16).** Fact 1 confirmed: guard commands at yaml:529,537;
`quality-control → failed` `kind: always` fallthrough at yaml:539-544; both the source file and the synced
`apps/cli/plugins/kk/workflows/kk-daily-ai-voice.yaml` copy carry them. Fact 2 confirmed: CLOSED entry at
`docs/tasks/0139_fix-daily-ai-voice-content-quality-and-qc-gating-defects.md:91-93`. Fact 3 confirmed and
sharpened: the on-disk `_11_generate_content.json` (mtime 12:46:03Z ≈ step-timing 12:46:04Z — it is the
run's own artifact) carries `passed:false`, `overallScore:50`, and 2 segments with `repetition_detected`;
R5a did not fire on those because it shipped AFTER this run in 0139's fix (`031e6537`) — expected, not a
contradiction. New lead for R1: `spur workflow trace --json` proves the spur engine executes this workflow
(`f6-integration-*` entries), but no dogfood-era run record has been located, and no record named
`dogfood-daily-031816` exists under `.spur/run/` — that id is a docs label only. Executor bypass
(manual/agent stage advance outside the engine) is therefore a live candidate alongside guard
non-evaluation under the engine.

### Requirements

- [x] R1. Name the 2026-09-16 non-firing mechanism with evidence. Query `spur workflow trace --json` for a
  `kk-daily-ai-voice` run spanning 2026-09-16T10:18–12:50Z: if a run record exists, extract which
  `quality-control` edge fired and its guard evaluation; if none exists, the dogfood was driven outside
  the spur engine (manual/agent stage advance) and the yaml edges were never live for that run. Note:
  `dogfood-daily-031816` is a label in the 0138/0139 docs, not a spur run id — no such record exists under
  `.spur/run/` (verified during ready-depth refine, 2026-09-16). Record the finding in `## Root Cause`.
- [x] R2. Operator decision, explicitly confirmed (Q&A item Q1): on degradation-class `qc.passed:false`
  (no `repetition_detected`), fail the run at the `quality-control` transition, or proceed warn-only?
  The recorded CLOSED decision (0139 Q&A entry 2026-09-16T19:08) is warn-only; this task ratifies or
  reverses it.
- [x] R3. Align implementation and record per R2 — exactly one of: (warn-only) relax the `qc.passed`
  conjuncts in the two guarded edges and delete the dead `quality-control → failed` fallthrough; (block)
  keep the yaml as-is and append a reversing entry to the 0139 Q&A record, flipping warn-only references.
  One behavior, one record.

Out of scope: R5a repetition hard-fail (0139, shipped); QC scoring and the `passed` computation in
`omni-voice-gen`; spur engine guard semantics; a full daily-pipeline re-run as verification (the
workflow-test fixture covers the branch).

### Acceptance Criteria

- AC1 (R1): `## Root Cause` names the 2026-09-16 non-firing mechanism — either a `spur workflow trace`
  run id plus the per-edge guard evidence for the `quality-control` transition, or trace-absence
  evidence showing the run was advanced outside the engine.
- AC2 (R2/R3): yaml transition text and the Q&A record state the same policy. Warn-only: no `qc.passed`
  conjunct remains on the `quality-control` edges and the dead `→ failed` fallthrough is removed.
  Block: the 0139 Q&A carries the dated reversing entry. A `passed:false` fixture case in
  `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` runs through the real spur engine and asserts the
  chosen terminal state.
- AC3 (regression): `bun test apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` green for both
  `passed:false` and `passed:true` branches; `spur workflow validate` clean on the edited yaml;
  `bun run lint` clean.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-17T00:03:46.312Z

#### Q&A entry — 2026-09-16T23:59:00.000Z (ready-depth refine)

1. **OPEN — Q1: gating policy (owner: Robin).** On degradation-class `qc.passed:false` (no
   `repetition_detected`): fail the run at the `quality-control` transition, or proceed warn-only?
   **Recommendation: warn-only (Design Branch A)** — it is the CLOSED 0139 decision, it matches observed
   behavior, and R5a already hard-fails the credibility-damaging class; blocking stalls the daily feed
   on degradation (loudness dips, transcription fidelity) that the verify loop cannot fix. Choosing
   block (Branch B) costs: a reversing entry in the 0139 Q&A, flipping the R5b report-block wording, and
   doc sync. **Answer needed before R3 executes.** Surfaced by `/sp:dev-refine 0140 --auto --depth ready`.

#### Q&A entry — 2026-09-17T01:00:04.028Z

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-17T00:03:46.312Z

#### Q&A entry — 2026-09-16T23:59:00.000Z (ready-depth refine)

1. **OPEN — Q1: gating policy (owner: Robin).** On degradation-class `qc.passed:false` (no
   `repetition_detected`): fail the run at the `quality-control` transition, or proceed warn-only?
   **Recommendation: warn-only (Design Branch A)** — it is the CLOSED 0139 decision, it matches observed
   behavior, and R5a already hard-fails the credibility-damaging class; blocking stalls the daily feed
   on degradation (loudness dips, transcription fidelity) that the verify loop cannot fix. Choosing
   block (Branch B) costs: a reversing entry in the 0139 Q&A, flipping the R5b report-block wording, and
   doc sync. **Answer needed before R3 executes.** Surfaced by `/sp:dev-refine 0140 --auto --depth ready`.

#### Q&A entry — 2026-09-17T01:00:03.000Z

1. **CLOSED — Q1: gating policy (owner: Robin).** Answered in-session during the 0140 pipeline run, with
   evidence the ready-depth refine did not have (see `## Root Cause`): the `qc.passed` guard was a
   **no-op** — jq's `//` returns `true` even when `passed:false`, so the `quality-control → failed` edge
   was unreachable and the gate has never gated. Operator decision: **ratify warn-only (Design Branch A)**
   — delete the dead conjuncts and the unreachable fallthrough so the yaml states what the workflow
   actually does. Rationale: the deletion is behaviour-neutral (trace `dogfood-daily-031816` shows
   `quality-control → publish-prep` firing with `passed:false` on disk), R5a already hard-fails the
   credibility-damaging `repetition_detected` class upstream, and blocking degradation-class audits
   (loudness dips, transcription fidelity) would stall the daily feed on defects the verify loop cannot
   fix. This ratifies the 0139 CLOSED decision (entry 2026-09-16T19:08:00.000Z,
   `docs/tasks/0139_fix-daily-ai-voice-content-quality-and-qc-gating-defects.md`); the 0139 R5b
   run-report QC block is unchanged and remains the visibility channel.
### Design

**WHAT** — reconcile the yaml `qc.passed` gate with the recorded warn-only policy: name why the
`quality-control → failed` edge did not fire on 2026-09-16 (R1), get the operator's explicit policy (R2),
then make yaml text and record agree (R3). **WHY** — today the next degradation-class `passed:false` run
resolves the ambiguity by accident. **WHERE** — `plugins/kk/workflows/kk-daily-ai-voice.yaml:523-545`
(source of truth); the synced copy `apps/cli/plugins/kk/workflows/kk-daily-ai-voice.yaml` (propagate via
the project's plugin-sync, never hand-edit the copy alone); regression test
`apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`.

**R1 investigation (no code change).** `spur workflow trace --json` already lists `kk-daily-ai-voice`
runs (mode `state-machine`), so the engine does execute this workflow — a dogfood-era run record is the
decider. If found: read which `quality-control` edge fired and the guard output. If absent: the run was
advanced outside the engine and the guarded edges were inert for it. Either finding lands in
`## Root Cause` with run-id/trace evidence.

**R3 Branch A — warn-only (recommended; matches the CLOSED 0139 record).** All edits in the source yaml:
(1) drop the `&& test "$(jq -r '.metadata.qc.passed // true' …)" = "true"` conjunct from
`quality-control → publish-prep` (:529) and `quality-control → done` (:537); (2) delete the
`quality-control → failed` `kind: always` fallthrough (:539-544) — with `publish_enabled` covering both
branches it becomes unreachable, and a state-level failure still fails the run at engine level, so no
safety is lost; (3) reword the two edge descriptions to drop "AND QC passed". No 0139 content edit
needed — its Q&A already records warn-only; append a one-line cross-ref to 0140 there. Warn-only
visibility stays via the 0139 R5b run-report QC block — unchanged.

**R3 Branch B — block.** Yaml stays as-is. Append a dated Q&A entry to
`docs/tasks/0139_fix-daily-ai-voice-content-quality-and-qc-gating-defects.md` reversing the CLOSED
warn-only item (reason + pointer to 0140), and flip warn-only framing at the R5b report-block site
(`plugins/kk/scripts/kk-workflow-stages.ts`) and in any docs stating warn-only. Larger blast radius:
re-litigates a decided call and stalls the daily feed on degradation the verify loop cannot fix.

**Fixture / verification (both branches).** Extend `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` —
it already drives real engine runs (trace runIds `f6-integration-*`) with stub states. Add a
`passed:false` case asserting the chosen terminal edge (Branch A: `publish-prep`/`done`, never `failed`;
Branch B: `failed`) and keep a `passed:true` case. Plus `spur workflow validate
plugins/kk/workflows/kk-daily-ai-voice.yaml` after the edit.

**Frozen names.** Guard path `metadata.qc.passed` in
`${vars.work_dir}/3-audio/${vars.run_date}_11_generate_content.json`; edges
`quality-control → publish-prep|done|failed`. No new API, no new workflow vars, no config knob.

**Anti-patterns (do not implement).** No `qc_gate=warn|block` knob — a knob re-opens the ambiguity this
task exists to close. No per-issue-class gating in the yaml — policy finer than pass/fail belongs in the
generator's qc computation, not in workflow guards. No spur-engine guard-semantics changes — the engine
is shared; this task is policy reconciliation. No retroactive edits to 0139 Requirements/AC — Branch B
appends one dated Q&A entry only.

**Cross-task.** No `dependencies[]`. Assumes 0138 and 0139 done (R5a hard-fail and R5b report block
shipped; warn-only recorded). Leaves the aligned policy as the contract the R5b report block relies on.
Mutation budget: Branch A = source yaml + workflow test + doc-sync check (`docs/design/kk-daily-ai-voice.md`,
`docs/04_DESIGN.md` where they state the gate); Branch B adds the 0139 Q&A append and the R5b
report-block wording.

### Plan

1. R1 — run `spur workflow trace --json`, filter `workflowName=="kk-daily-ai-voice"` around
   2026-09-16T10:18–12:50Z; write the finding (which edge fired + guard output, or executor bypass on
   trace-absence) into `## Root Cause` with run-id evidence.
2. R2 — surface Q&A item Q1 to the operator; record the answer as a dated Q&A entry (skip if already
   answered at execution time).
3. R3 — apply Branch A or Branch B per the Q1 answer, exactly as frozen in `## Design`; propagate to
   `apps/cli/plugins/kk/workflows/kk-daily-ai-voice.yaml` via the project plugin-sync path (do not
   hand-edit the copy).
4. Regression — extend `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` with the `passed:false`
   branch case per `## Design`; run `bun test apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` and
   `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml`; then `bun run lint`.
5. Doc sweep — `rg -n "qc.passed|QC passed" docs/04_DESIGN.md docs/design/kk-daily-ai-voice.md`; sync any
   statement of the old gate in the same commit (T3).

### Root Cause

**R1 — the 2026-09-16 `quality-control → failed` edge never fired because the guard was a no-op, not because the run bypassed the engine.**

The run *was* engine-driven, so both guarded edges were live. `spur workflow trace --json` holds a per-run record the ready-depth refine missed:

```text
runId            dogfood-daily-031816
workflowName     kk-daily-ai-voice
mode             state-machine
status           done
startedAt        2026-09-16T10:18:17.209Z
completedAt      2026-09-16T12:50:51.485Z
definitionDigest sha256:ef7befd8d6fb00d33089cced38898c39db0c58d7b55dcb2b7cbddbc1b159ef27
```

The refine note ("no record named `dogfood-daily-031816` exists under `.spur/run/` — that id is a docs label only") was true but misleading: the id is not a *file* under `.spur/run/`, it is a row in the persisted workflow run history, which is why a filesystem check missed it. Trace absence is therefore **not** evidence of executor bypass here.

`spur workflow trace dogfood-daily-031816` gives the timeline with the guard's outcome:

```text
quality-control  running  2026-09-16T12:46:04.279Z
  → generate → quality-control      2026-09-16T12:46:04.279Z
  ⚡ quality-control/shell  done  82ms  ✓
publish-prep     running  2026-09-16T12:46:04.455Z
  → quality-control → publish-prep  2026-09-16T12:46:04.455Z
```

So `quality-control → publish-prep` is the edge that fired, 176 ms after the state was entered, and the run never reached `→ failed`.

**Why the guard could not have done otherwise.** The conjunct was:

```sh
jq -r '.metadata.qc.passed // true' "${vars.work_dir}/3-audio/${vars.run_date}_11_generate_content.json"
```

jq's `//` (alternative) yields the right-hand side not only for `null`/missing but for **`false`** — per the jq manual, "`a // b` produces the same results as `a`, if `a` produces results other than false and null. Otherwise, `a // b` produces the same results as `b`." Reproduced against the run's own artifact (mtime 12:46:03Z, matching the step-timing entry — the on-disk file is this run's):

```text
$ jq -c '.metadata.qc | {passed, overallScore, n: (.segmentAudits|length)}' \
    .works/kk-daily-ai-voice/2026-09-16/3-audio/20260916_11_generate_content.json
{"passed":false,"overallScore":50,"n":16}

$ jq -r '.metadata.qc.passed // true' <same file>
true
```

`"true" = "true"`, so the conjunct passes. The default-true fallback, meant to keep an *absent* audit from blocking, silently swallows exactly the value the guard exists to detect: present-and-false, present-and-true and missing all evaluate to `"true"`. Every edge out of `quality-control` therefore resolved identically for every input, making the `kind: always` fallthrough to `failed` **unreachable** — the gate has never gated, since `ef56d492` (2026-09-07) introduced it.

**Consequence for R3.** Because the guard is inert, Branch A (delete it) is **behaviour-neutral**: it removes code that reads as a safety check but cannot fail, and leaves observable behaviour exactly as the 2026-09-16 run showed. The opposite branch would first require fixing the `//` expression — a real behaviour change that starts failing runs on degradation-class audits.

**Premise correction (propagation step).** The Design/Plan called for propagating the edit to a synced copy at `apps/cli/plugins/kk/workflows/kk-daily-ai-voice.yaml`. No such file exists in a working tree: `.gitignore:161` ignores the whole staging directory, and it is produced only by `apps/cli`'s `build:bundle` (`scripts/bundle-plugins.ts`) at pack time. There is one editable source, `plugins/kk/workflows/kk-daily-ai-voice.yaml`; the staging step was run to confirm it carries the edit (staged guards read `test "${vars.publish_enabled}" = "true"` / `!= "true"`, zero `quality-control → failed` edges).

### Solution
Change map: one `file:line` per changed line, as emitted by `spur task record --solution-from-diff`.

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:218` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:241` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:310` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:380` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:390` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:424` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:466` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:493` |

**Rationale.** One policy, one record, no behaviour change.

- **R1 — the mechanism, not the executor.** The ready-depth refine read trace-absence under `.spur/run/` as evidence of an executor bypass. That inference was wrong: `spur workflow trace --json` keeps the run history in the database, and `dogfood-daily-031816` is there. With the engine confirmed as the driver, the per-edge timeline shows `quality-control → publish-prep` firing 176 ms after the state was entered, so the question became why the guard passed — and the answer is jq's `//`: it returns the right-hand side for `false` as well as for `null`/missing, so `.metadata.qc.passed // true` printed `true` for a failing audit. The default-true fallback, meant to keep an absent audit from blocking, swallowed precisely the value the guard existed to detect.
- **R2 — the operator decided with the mechanism in hand.** Q1 was surfaced in-session rather than auto-resolved under `--auto`, because the choice is a policy call about a live feed and the no-op finding changed what each branch costs. The answer (warn-only) is recorded as a dated Q&A entry that states the evidence, the rationale and the 0139 decision it ratifies.
- **R3 — Branch A, chosen because it is behaviour-neutral.** Deleting a guard that cannot fail leaves observable behaviour exactly as the 2026-09-16 run demonstrated, so the yaml stops advertising a gate it never enforced. The two surviving edges (`publish_enabled = "true"` / `!= "true"`) are mutually exclusive and exhaustive, so `quality-control` always resolves to exactly one successor and dropping the `kind: always` fallthrough removes only unreachable code. A comment at the site records the mechanism and warns against restoring the guard without fixing the `//` expression — that is what keeps the dead gate from being re-added by the next reader.
- **Propagation.** The Design's "synced copy" at `apps/cli/plugins/kk/workflows/kk-daily-ai-voice.yaml` does not exist in a working tree: `.gitignore:161` ignores the staging directory and it is produced only by `apps/cli`'s `build:bundle` at pack time. There is one editable source; `build:bundle` was run to confirm the staged copy carries the edit and is regenerated, never hand-edited.
- **Verification.** The regression case drives a `passed:false` generation (with a `loudness_dip` audit, no repetition) through the real engine and asserts the run reaches its normal terminal instead of `failed`; the static case pins the edge contract so a future edit cannot silently reintroduce a `qc.passed` conjunct or a `→ failed` fallthrough. `docs/04_DESIGN.md`'s statement of the old gate was synced in the same commit (T3); `docs/design/kk-daily-ai-voice.md:67` was deliberately left, since it describes the separate generate-cache predicate.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `## Root Cause` names the mechanism with a run id and per-edge guard evidence. `spur workflow trace --json` yields a real per-run record — `dogfood-daily-031816`, `workflowName kk-daily-ai-voice`, `mode state-machine`, `status done`, `startedAt 2026-09-16T10:18:17.209Z`, `completedAt 2026-09-16T12:50:51.485Z`, `definitionDigest sha256:ef7befd8…` — refuting the refine's "docs label only" premise: the id is a row in the run history, not a file under `.spur/run/`. `spur workflow trace dogfood-daily-031816` shows `quality-control/shell done 82ms` at `12:46:04.279Z` and then `quality-control → publish-prep` at `12:46:04.455Z`, so the guarded edge was evaluated and the publish branch fired; the run never reached `→ failed`. Cause: `jq -r '.metadata.qc.passed // true'` returns `true` for `passed:false` because jq's `//` treats `false` as empty — reproduced on the run's own artifact (`.works/kk-daily-ai-voice/2026-09-16/3-audio/20260916_11_generate_content.json`, `{"passed":false,"overallScore":50,"n":16}`) which prints `true`, making the `kind: always` fallthrough unreachable since `ef56d492` |
| R2 | MET | The operator was asked in-session with the new evidence and answered **ratify warn-only (Design Branch A)**; recorded as a dated Q&A entry (`2026-09-17T01:00:03.000Z`) that states the policy, the rationale, and the explicit ratification of the 0139 CLOSED entry it supersedes nothing in — 0139 recorded warn-only and 0140 now makes the yaml agree |
| R3 | MET | Branch A applied in `plugins/kk/workflows/kk-daily-ai-voice.yaml:523-545`: the `qc.passed` conjunct is gone from both guarded edges (guards now `test "${vars.publish_enabled}" = "true"` and `!= "true"`), the unreachable `quality-control → failed` `kind: always` edge is deleted, and the two edge descriptions were reworded. The remaining pair is mutually exclusive and exhaustive, so `quality-control` always has exactly one viable edge — no safety is lost by dropping the fallthrough. `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml` exit 0; the pack-time staged copy (`apps/cli` `build:bundle`, gitignored) carries the edit; the old-gate statement in `docs/04_DESIGN.md:334` is synced in the same commit (T3) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | Ran `spur workflow trace --json` filtered to `workflowName=="kk-daily-ai-voice"` (19 runs; `dogfood-daily-031816` present) and `spur workflow trace dogfood-daily-031816` for per-edge detail (`quality-control/shell done 82ms`, then `→ quality-control → publish-prep` at `12:46:04.455Z`), then reproduced the guard against the run's own artifact: `jq -r '.metadata.qc.passed // true'` prints `true` while `jq -c '.metadata.qc'` reports `passed:false`. All three are transcribed in the task's `## Root Cause` with the run id and digest |
| AC2 | MET | test | Policy agreement: no `qc.passed` conjunct remains on the `quality-control` edges and the `→ failed` fallthrough is gone (asserted by guard-command text in `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:218`, which also pins the two surviving edges), and the Q&A entry records the same warn-only policy that the yaml now implements. Engine assertion: `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:493` drives a `passed:false` generation through the real spur engine (`KK_TEST_QC_PASSED=false` makes the stub emit `metadata.qc.passed:false` with a `loudness_dip` audit) and asserts the run still exits 0, the artifact records `passed:false`, and no publish plugin is invoked — i.e. the `done` terminal, never `failed`; the two `passed:true` cases continue to cover the unchanged path |
| AC3 | MET | test | `bun test apps/cli/tests/kk-daily-ai-voice-workflow.test.ts` → 10 pass / 0 fail (both `passed:true` generators plus the `passed:false` case); `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice.yaml` → exit 0; `bun run lint` → exit 0 (biome + typecheck over every workspace). Additionally this run: `bun run test` 1072 pass / 0 fail, `bun run build` exit 0, `apps/cli` `build:bundle` exit 0 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0140

**Scope:** task 0140 diff — 4 files (141 insertions / 17 deletions): the daily-voice workflow yaml, its integration test, `docs/04_DESIGN.md`, and the task corpus (Root Cause + ratified Q&A)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P4 (advisory) | efficiency | The **generate cache** predicate still gates on `qc.passed === true`, so under the ratified warn-only policy a `passed:false` episode publishes but is not cached — the next run re-renders its audio (the 2026-09-16 run's generate step took ~118 min). This is the one remaining place where a warn-only `passed:false` changes behaviour. Out of 0140's frozen scope (the task freezes the transition edges, not the cache predicate) and a cost rather than a correctness issue; worth a follow-up only if daily re-runs become common. | `plugins/kk/scripts/kk-workflow-stages.ts:873` |
| 2 | P4 (advisory) | correctness | The `passed:false` fixture runs with `publish_enabled:'false'`, so it asserts the `→ done` terminal; the `→ publish-prep` branch is covered by the static edge assertion rather than an engine run (driving the publish tail would need the publish-plugin stubs plus the translate states). AC2 asks for "the chosen terminal state", which the `done` case proves, and the surviving guard is a one-clause `publish_enabled` test — noting the coverage shape rather than claiming more. | `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:493` |
| 3 | P4 (advisory) | usability | `docs/design/kk-daily-ai-voice.md:67` still names `metadata.qc.passed`, but it describes the **generate cache** predicate (finding 1), not the removed transition gate. Deliberately left unchanged: the statement is accurate, and "syncing" it would conflate two different mechanisms. Flagged so the next reader does not rewrite it into a wrong claim. | `docs/design/kk-daily-ai-voice.md:67` |
| 4 | P4 (advisory) | usability | The yaml keeps a comment naming `qc.passed` so a future reader does not restore the broken expression; the test's static assertion is therefore scoped to guard-**command** text instead of the whole file (documented inline). A grep for `qc.passed` in the yaml hits the comment first — intended. | `plugins/kk/workflows/kk-daily-ai-voice.yaml:523` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `## Root Cause` names the mechanism with a run id and per-edge guard evidence: `spur workflow trace --json` yields `dogfood-daily-031816` (`kk-daily-ai-voice`, `mode state-machine`, `done`, `2026-09-16T10:18:17.209Z`→`12:50:51.485Z`, `definitionDigest sha256:ef7befd8…`), and `spur workflow trace dogfood-daily-031816` shows `quality-control/shell done 82ms` at `12:46:04.279Z` followed by `quality-control → publish-prep` at `12:46:04.455Z` — the run never reached `→ failed`. Mechanism: `jq -r '.metadata.qc.passed // true'` returns `true` for `passed:false` (jq's `//` treats `false` as empty), reproduced against the run's own artifact `{"passed":false,"overallScore":50,"n":16}` → `true`, making the `kind: always` fallthrough unreachable since `ef56d492` |
| R2 | MET | Q&A entry dated 2026-09-17T01:00:03.000Z records the operator's ratified decision (warn-only / Branch A) with the new evidence and an explicit pointer back to the 0139 CLOSED entry it ratifies |
| R3 | MET | Branch A applied in `plugins/kk/workflows/kk-daily-ai-voice.yaml:523-545`: both `qc.passed` conjuncts dropped (guards are now `test "${vars.publish_enabled}" = "true"` / `!= "true"` — mutually exclusive and exhaustive, so removing the `always` fallthrough leaves `quality-control` always one viable edge) and the unreachable `quality-control → failed` edge deleted. `spur workflow validate` exit 0; the staged copy produced by `apps/cli` `build:bundle` carries the edit; the old-gate statement at `docs/04_DESIGN.md:334` synced in the same commit (T3) |

**Next:** proceed to `/sp:dev-verify 0140` — observe-only verification against AC1–AC3.

### References

- 0139 Q&A CLOSED entry (warn-only decision):
  `docs/tasks/0139_fix-daily-ai-voice-content-quality-and-qc-gating-defects.md:91-93`
  (entry 2026-09-16T19:08:00.000Z).
- Yaml transitions: `plugins/kk/workflows/kk-daily-ai-voice.yaml:523-545` — guarded edges :523-538
  (guard commands :529, :537), `→ failed` `kind: always` fallthrough :539-544; guards introduced by
  `ef56d492` (2026-09-07). Synced copy: `apps/cli/plugins/kk/workflows/kk-daily-ai-voice.yaml`.
- Dogfood evidence: `.works/kk-daily-ai-voice/2026-09-16/step-timing.json`
  (`generate → quality-control → publish-prep → … → publish`);
  `3-audio/20260916_11_generate_content.json` (`passed:false`, `overallScore:50`, 2 segments with
  `repetition_detected`; mtime 12:46:03Z matches step-timing — the on-disk file is the run's own);
  `3-publish/…_17_publish_publish-status.txt` (`full`). `repetition_detected` did not fire R5a in this
  run because R5a shipped later in 0139's fix (`031e6537`).
- Repetition hard-fail (the class that still blocks): 0139 R5a,
  `plugins/generations/omni-voice-gen/src/omni_voice_gen/pipeline.py:312-321`.
- Executor evidence: `spur workflow trace --json` lists `kk-daily-ai-voice` engine runs (e.g.
  `f6-integration-*`, produced by `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts`); no
  `dogfood-daily-031816` record exists under `.spur/run/` — the id is a docs label only.
- R1 run-history query:
  `spur workflow trace --json | jq '.entries[] | select(.workflowName=="kk-daily-ai-voice")'`.

### History

- 2026-09-17T01:01:40.301Z todo → wip (system)
- 2026-09-17T01:03:57.781Z wip → testing (system)
- 2026-09-17T01:04:07.810Z testing → done (system)

