---
schema_version: 1
name: Verify the confidence level (HIGH|MEDIUM|LOW) on kk-collect and kk-daily-ai-voice2 verdict and decision surfaces
status: backlog
template: feature-impl
created_at: 2026-10-07T06:07:21.798Z
updated_at: "2026-10-07T06:08:35.246Z"
feature_id: G31

ac_altitude: task-local
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

- [ ] R1. Enumerate every `kk-collect` / `kk-daily-ai-voice2` verdict and decision surface that emits or consumes a label, and record for each whether it carries a `HIGH|MEDIUM|LOW` confidence level, citing the emitting/consuming `file:line`.
- [ ] R2. Every surface found in R1 that emits a pass-like outcome without a confidence level emits exactly one level from HIGH, MEDIUM, and LOW.
- [ ] R3. Every consumer of such a verdict refuses a missing or out-of-enum confidence instead of treating it as a pass, and names the offending value in the refusal.
- [ ] R4. The accept/refuse behavior is proven by a test that executes the REAL guard or consumer logic over fixture verdicts (guard strings read from the workflow YAML where the consumer is a workflow guard — never a duplicated copy), leaving a repeatable artifact under `.spur/run/`.

### Acceptance Criteria

- [ ] AC1 — Verdict and decision surfaces carry a HIGH, MEDIUM, or LOW confidence level
- [ ] AC2 — The R1 inventory exists, one row per surface, each naming the `file:line` that emits or consumes the verdict and whether it carries a confidence level or is a named gap.
- [ ] AC3 — Given a fixture verdict whose confidence is absent or outside HIGH, MEDIUM, LOW, when the consumer reads it, then the verdict is not treated as a pass, the routing stays fail-closed rather than deadlocking, and the refusal names the offending value.
- [ ] AC4 — The proof executes the real guard/consumer strings over the fixtures, is repeatable, and records its artifact path in `## Testing`.

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

### Plan

- [ ] Inventory the G31 emit/consume surfaces (R1): `kk store label` decision path, `kk-collect` workflow, `kk-daily-ai-voice2` judge/safety gates — one row each with `file:line` + carries/gap.
- [ ] `ac_altitude: task-local` is set: these criteria are finer-grained than the feature's ship contract.
- [ ] Close each named gap: emit exactly one of HIGH/MEDIUM/LOW (R2), refuse missing/out-of-enum by name (R3).
- [ ] Extend `plugins/kk/tests/verdict-confidence.test.ts` (or add a sibling) so the new consumer's guard string is read from the workflow YAML, not copied (R4).
- [ ] Add falsification cases: missing confidence, out-of-enum value, and a valid level — assert routing for each, including that none deadlocks.
- [ ] Emit the repeatable artifact under `.spur/run/` and cite its path in `## Testing`.
- [ ] Update `docs/04_DESIGN.md` in the same commit if a new guard/verb surface is added.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
