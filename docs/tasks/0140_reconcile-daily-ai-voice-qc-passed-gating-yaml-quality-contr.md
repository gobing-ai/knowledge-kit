---
schema_version: 1
name: "Reconcile daily-ai-voice qc.passed gating: yaml quality-control edge vs recorded warn-only decision"
status: todo
template: issue
created_at: 2026-09-16T23:47:28.960Z
updated_at: "2026-09-17T00:03:46.502Z"

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

- [ ] R1. Name the 2026-09-16 non-firing mechanism with evidence. Query `spur workflow trace --json` for a
  `kk-daily-ai-voice` run spanning 2026-09-16T10:18–12:50Z: if a run record exists, extract which
  `quality-control` edge fired and its guard evaluation; if none exists, the dogfood was driven outside
  the spur engine (manual/agent stage advance) and the yaml edges were never live for that run. Note:
  `dogfood-daily-031816` is a label in the 0138/0139 docs, not a spur run id — no such record exists under
  `.spur/run/` (verified during ready-depth refine, 2026-09-16). Record the finding in `## Root Cause`.
- [ ] R2. Operator decision, explicitly confirmed (Q&A item Q1): on degradation-class `qc.passed:false`
  (no `repetition_detected`), fail the run at the `quality-control` transition, or proceed warn-only?
  The recorded CLOSED decision (0139 Q&A entry 2026-09-16T19:08) is warn-only; this task ratifies or
  reverses it.
- [ ] R3. Align implementation and record per R2 — exactly one of: (warn-only) relax the `qc.passed`
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

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
