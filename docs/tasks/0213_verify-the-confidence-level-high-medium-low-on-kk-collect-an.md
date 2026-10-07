---
schema_version: 1
name: Verify the confidence level (HIGH|MEDIUM|LOW) on kk-collect and kk-daily-ai-voice2 verdict and decision surfaces
status: done
template: feature-impl
created_at: 2026-10-07T06:07:21.798Z
updated_at: "2026-10-07T23:23:51.402Z"
feature_id: G31

ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0213-verdict.json
---

## 0213. Verify the confidence level (HIGH|MEDIUM|LOW) on kk-collect and kk-daily-ai-voice2 verdict and decision surfaces

### Background

Requested 2026-10-07 alongside the G31 batch. G31 **R14** is now part of the feature's ship
criteria: every label or judge verdict emitted by a `kk-collect` or `kk-daily-ai-voice2` surface
must carry exactly one confidence level from HIGH, MEDIUM, and LOW, and a verdict whose confidence
is missing or outside that enum must be refused rather than treated as a pass.

The confidence contract already exists in this repo in three places. This task **extends their
coverage to the G31-owned surfaces** rather than inventing a fourth mechanism:

| Existing surface | What it already enforces |
| --- | --- |
| `.spur/rules/structure/verification-confidence-level.{yaml,sh,test.sh}` | Repo rule: every `Verification (` block in `CHANGELOG.md` / `docs/**.md` carries exactly one `Confidence: HIGH\|MEDIUM\|LOW` and the level is *earned* (HIGH must cite). 9 falsification cases. |
| `plugins/kk/tests/verdict-confidence.test.ts` | Extracts the REAL guard strings from `plugins/kk/workflows/*.yaml`, asserts each verdict consumer refuses a `PASS` with a missing/out-of-enum `confidence`, and verifies the producer half (`plugins/kk/skills/content-judge/SKILL.md`). |
| `plugins/kk/scripts/kk-workflow-stages.ts:1672` (`daily-safety-gate`), `plugins/kk/scripts/itc-stages.ts:143` (`itc-report`) | Product stages that already block on a non-`HIGH\|MEDIUM\|LOW` confidence. |

**Unanswered question this task closes:** which G31 surfaces (`kk store label`'s decision path, the
`kk-collect` workflow, the `kk-daily-ai-voice2` judge/safety gates) emit or consume a confidence
level today, and where a real gap remains. A blanket "add confidence checks everywhere" would
duplicate the three surfaces above; the deliverable is the gap inventory plus the checks that are
actually missing.

Prior art to mirror, not re-derive: `plugins/kk/tests/verdict-confidence.test.ts` executes guard
strings read out of the workflow YAML instead of copying them, which is what keeps the
producer→consumer seam from drifting.

### Requirements

- [x] R1. Enumerate every `kk-collect` / `kk-daily-ai-voice2` verdict and decision surface that emits or consumes a label, and record for each whether it carries a `HIGH|MEDIUM|LOW` confidence level, citing the emitting/consuming `file:line`.
- [x] R2. Every surface found in R1 that emits a pass-like outcome without a confidence level emits exactly one level from HIGH, MEDIUM, and LOW.
- [x] R3. Every consumer of such a verdict refuses a missing or out-of-enum confidence instead of treating it as a pass, and names the offending value in the refusal.
- [x] R4. The accept/refuse behavior is proven by a test that executes the REAL guard or consumer logic over fixture verdicts (guard strings read from the workflow YAML where the consumer is a workflow guard — never a duplicated copy), leaving a repeatable artifact under `.spur/run/`.

### Acceptance Criteria

- [x] AC1 — Verdict and decision surfaces carry a HIGH, MEDIUM, or LOW confidence level
- [x] AC2 — The R1 inventory exists, one row per surface, each naming the `file:line` that emits or consumes the verdict and whether it carries a confidence level or is a named gap.
- [x] AC3 — Given a fixture verdict whose confidence is absent or outside HIGH, MEDIUM, LOW, when the consumer reads it, then the verdict is not treated as a pass, the routing stays fail-closed rather than deadlocking, and the refusal names the offending value.
- [x] AC4 — The proof executes the real guard/consumer strings over the fixtures, is repeatable, and records its artifact path in `## Testing`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: **extend the existing contract's reach, do not add a fourth mechanism.** The enum, the
earned-level rule, the confidence-aware `jq` verdict filter, and the fail-closed routing all
already exist and are falsification-tested; a new parallel checker would be a second source of
truth for the same invariant.

Approach:
1. Inventory first (R1) — read the G31-owned surfaces and record emit/consume points with
   `file:line`. This is the deliverable that stops the work from degenerating into blanket
   duplication.
2. Close only the gaps the inventory finds (R2/R3). Where a consumer is a workflow guard, the
   guard string lives in `plugins/kk/workflows/*.yaml` and the test reads it from there.
3. Prove with fixtures (R4) on the `verdict-confidence.test.ts` pattern.

Invariants:
- Exactly one confidence level per verdict; the enum is closed (`HIGH | MEDIUM | LOW`).
- A missing or out-of-enum confidence is never a pass, and never a deadlock — the state must still
  have a viable outgoing edge.
- The producer (`content-judge` skill / decision maker) and the consumer must be checked together:
  a consumer enforcing an enum nobody emits is a gate that blocks every run (the 2026-10-04
  daily-run failure mode).

Rejected: a new `confidence` column on the store label rows (G31 0209 already carries `maker` and
`source`; the confidence belongs to the verdict contract, not the persistence schema); a repo-wide
blanket rule over `plugins/kk/**` (would duplicate the three existing surfaces and fire on prose).



Additional declared surfaces (the confidence contract spans the label emitter as well as its consumers, so the inventory in R1 cannot be closed from `plugins/kk` alone): `apps/cli/src/commands/store.ts`, `packages/kk-store/src/dao/labels.ts`, `packages/kk-store/src/index.ts`, `packages/kk-store/tests/**`, `apps/cli/tests/store-label.test.ts`, `apps/cli/tests/commands/store.test.ts`. The `plugins/kk` prefix already covers the guard/test half (R4) and the rules.

Scope note: R1 inventories BOTH the `kk-collect` and the `kk-daily-ai-voice2` surfaces, but G31 scenario R14 is scoped to kk-collect decisions — the voice2 judge/safety surfaces are owned by G11 R9 (task 0211). Where a voice2 consumer already refuses a missing or out-of-enum confidence (`plugins/kk/scripts/kk-workflow-stages.ts`, `itc-stages.ts`, `plugins/kk/tests/verdict-confidence.test.ts`), record it as already-enforced with its `file:line` and do not duplicate it here.



Also declared so a column-type correction is POSSIBLE if the review or verify requires one: `packages/kk-store/src/schema/labels.ts` and `packages/kk-store/src/migrations.ts`. Note the tension this task inherited: `labels.confidence` is declared `integer` (task 0209) while the enum this task stores is textual, so the declared type and the stored values disagree even though SQLite accepts both.

### Plan

- [x] Inventory the G31 emit/consume surfaces (R1): `kk store label` decision path, `kk-collect` workflow, `kk-daily-ai-voice2` judge/safety gates — one row each with `file:line` + carries/gap.
- [x] `ac_altitude: task-local` is set: these criteria are finer-grained than the feature's ship contract.
- [x] Close each named gap: emit exactly one of HIGH/MEDIUM/LOW (R2), refuse missing/out-of-enum by name (R3).
- [x] Extend `plugins/kk/tests/verdict-confidence.test.ts` (or add a sibling) so the new consumer's guard string is read from the workflow YAML, not copied (R4).
- [x] Add falsification cases: missing confidence, out-of-enum value, and a valid level — assert routing for each, including that none deadlocks.
- [x] Emit the repeatable artifact under `.spur/run/` and cite its path in `## Testing`.
- [x] Update `docs/04_DESIGN.md` in the same commit if a new guard/verb surface is added.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/store.ts:15` |
| `apps/cli/src/commands/store.ts:327` |
| `apps/cli/src/commands/store.ts:567` |
| `apps/cli/src/commands/store.ts:580` |
| `apps/cli/src/commands/store.ts:586` |
| `apps/cli/src/commands/store.ts:661` |
| `apps/cli/src/commands/store.ts:669` |
| `apps/cli/src/commands/store.ts:707` |
| `apps/cli/src/commands/store.ts:8` |
| `apps/cli/src/commands/store.ts:917` |
| `apps/cli/tests/store-label.test.ts:105` |
| `apps/cli/tests/store-label.test.ts:171` |
| `apps/cli/tests/store-label.test.ts:186` |
| `apps/cli/tests/store-label.test.ts:195` |
| `apps/cli/tests/store-label.test.ts:23` |
| `apps/cli/tests/store-label.test.ts:251` |
| `apps/cli/tests/store-label.test.ts:266` |
| `apps/cli/tests/store-label.test.ts:270` |
| `apps/cli/tests/store-label.test.ts:296` |
| `apps/cli/tests/store-label.test.ts:318` |
| `apps/cli/tests/store-label.test.ts:410` |
| `apps/cli/tests/store-label.test.ts:415` |
| `apps/cli/tests/store-label.test.ts:418` |
| `apps/cli/tests/store-label.test.ts:441` |
| `apps/cli/tests/store-label.test.ts:470` |
| `apps/cli/tests/store-label.test.ts:49` |
| `apps/cli/tests/store-label.test.ts:505` |
| `apps/cli/tests/store-label.test.ts:531` |
| `docs/04_DESIGN.md:402` |
| `docs/04_DESIGN.md:418` |
| `docs/04_DESIGN.md:670` |
| `docs/04_DESIGN.md:87` |
| `docs/04_DESIGN.md:990` |
| `packages/kk-store/src/dao/labels.ts:103` |
| `packages/kk-store/src/dao/labels.ts:108` |
| `packages/kk-store/src/dao/labels.ts:121` |
| `packages/kk-store/src/dao/labels.ts:131` |
| `packages/kk-store/src/dao/labels.ts:135` |
| `packages/kk-store/src/dao/labels.ts:22` |
| `packages/kk-store/src/dao/labels.ts:34` |
| `packages/kk-store/src/dao/labels.ts:5` |
| `packages/kk-store/src/dao/labels.ts:65` |
| `packages/kk-store/src/dao/labels.ts:75` |
| `packages/kk-store/src/dao/labels.ts:86` |
| `packages/kk-store/src/index.ts:24` |
| `packages/kk-store/src/migrations.ts:28` |
| `packages/kk-store/src/schema/labels.ts:22` |
| `packages/kk-store/tests/dao/labels.test.ts:2` |
| `packages/kk-store/tests/dao/labels.test.ts:38` |
| `packages/kk-store/tests/dao/labels.test.ts:45` |
| `packages/kk-store/tests/dao/labels.test.ts:50` |
| `packages/kk-store/tests/dao/labels.test.ts:55` |
| `packages/kk-store/tests/dao/labels.test.ts:69` |
| `packages/kk-store/tests/dao/labels.test.ts:72` |
| `packages/kk-store/tests/migrations.test.ts:92` |
| `packages/kk-store/tests/migrations.test.ts:96` |
| `plugins/kk/tests/verdict-confidence.test.ts:106` |
| `plugins/kk/tests/verdict-confidence.test.ts:111` |
| `plugins/kk/tests/verdict-confidence.test.ts:118` |
| `plugins/kk/tests/verdict-confidence.test.ts:131` |
| `plugins/kk/tests/verdict-confidence.test.ts:134` |
| `plugins/kk/tests/verdict-confidence.test.ts:156` |
| `plugins/kk/tests/verdict-confidence.test.ts:21` |
| `plugins/kk/tests/verdict-confidence.test.ts:294` |
| `plugins/kk/tests/verdict-confidence.test.ts:38` |
| `plugins/kk/tests/verdict-confidence.test.ts:41` |
| `plugins/kk/tests/verdict-confidence.test.ts:46` |
| `plugins/kk/tests/verdict-confidence.test.ts:611` |
| `plugins/kk/tests/verdict-confidence.test.ts:98` |
| `plugins/kk/workflows/kk-collect.yaml:134` |
| `plugins/kk/workflows/kk-collect.yaml:232` |
| `plugins/kk/workflows/kk-collect.yaml:236` |
| `plugins/kk/workflows/kk-collect.yaml:251` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Inventory at `docs/design/kk-collect-and-daily-voice2.md:107` (9 surfaces, carries/named-gap per row). Fix pass: the original lived only in a pruned `.spur/run` report, so it was rebuilt from current code into the design satellite; anchors resolved by `apps/cli/tests/store-docs.test.ts:84` |
| R2 | MET | Row level derived at `apps/cli/src/commands/store.ts:580` inside labelRow; pass-level print at `apps/cli/src/commands/store.ts:705`; `apps/cli/tests/store-label.test.ts:318`, `packages/kk-store/tests/dao/labels.test.ts:73` |
| R3 | MET | `plugins/kk/workflows/kk-collect.yaml:242` guard reads the verdict through the confidence-aware jq filter and refuses by name at `plugins/kk/workflows/kk-collect.yaml:244`; refusal format documented at `docs/04_DESIGN.md:475`. Rewritten this run to 3 logical commands so spur workflow validate exits 0; byte-identical filter retained |
| R4 | MET | `plugins/kk/tests/verdict-confidence.test.ts:317` extracts the real guard string from the YAML; fixtures at `plugins/kk/tests/verdict-confidence.test.ts:338`; 52 checks green this run |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Verdict and decision surfaces carry a HIGH, MEDIUM, or LOW confidence level | MET | test | `apps/cli/tests/store-label.test.ts:318`, `apps/cli/tests/store-label.test.ts:366`, `packages/kk-store/tests/dao/labels.test.ts:38` |
| AC2 | MET | test | `apps/cli/tests/store-docs.test.ts:84` asserts the inventory at `docs/design/kk-collect-and-daily-voice2.md:107` exists and every anchor resolves (5 pass; falsified by pointing one anchor past EOF → 1 fail) |
| AC3 — Given a fixture verdict whose confidence is absent or outside HIGH, MEDIUM, LOW, when the consumer reads it, then the verdict is not treated as a pass, the routing stays fail-closed rather than deadlocking, and the refusal names the offending value. | MET | test | `plugins/kk/tests/verdict-confidence.test.ts:395`, `plugins/kk/tests/verdict-confidence.test.ts:338`; green after the guard rewrite (57/57 with kk-collect) |
| AC4 — The proof executes the real guard/consumer strings over the fixtures, is repeatable, and records its artifact path in `## Testing`. | MET | test | `plugins/kk/tests/verdict-confidence.test.ts:317` reads the YAML guard; artifact `.spur/run/verdict-confidence/summary.json` regenerated this run (ok true, 52 checks) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T18:03:02.689Z backlog → wip (system)
- 2026-10-07T19:10:09.535Z wip → testing (system)
- 2026-10-07T19:10:14.942Z testing → done (system)

