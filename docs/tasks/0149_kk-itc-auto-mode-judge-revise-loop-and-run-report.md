---
schema_version: 1
name: kk-itc auto mode, judge revise loop and run report
status: todo
template: feature-impl
created_at: 2026-09-22T16:46:32.541Z
updated_at: "2026-09-22T16:50:42.710Z"
feature_id: F41
priority: P2
tags:
  - F41
  - kk-itc
estimate_hours: 9

---

## 0149. kk-itc auto mode, judge revise loop and run report

### Background

Feature F41 extends kk-itc from rough idea to platform drafts (ADR-021). This slice changes the authoring half: an `auto` path, a de-slop pass, research evidence passed to the judge, and a NEEDS_REVISION loop on both paths. The run now ends in a run report.

Implements:
- R1 — kk-itc with default vars keeps its current states and pauses
- R2 — Auto mode commits the writer-recommended outline without pausing
- R3 — Auto mode revises on judge feedback up to max_revisions
- R4 — Interactive runs route NEEDS_REVISION back to draft revision
- R5 — Judge receives research evidence when research ran
- R6 — Unslop pass edits the draft before the judge runs

Design SSOT: `docs/design/kk-itc-end-to-end.md` §2, §3, §4 (`itc-outline-pick`, `itc-report`) and §6. Ordering: first task. It creates `plugins/kk/scripts/itc-stages.ts`, which later slices extend.

Rubric: E9 D1 L2 C1 R1 = 14. Decomposition: this slice covers the authoring states of `kk-itc.yaml` plus two helpers.

### Requirements

- [ ] R1. Add the vars `auto` (false), `unslop` (false) and `max_revisions` (2) to `plugins/kk/workflows/kk-itc.yaml`. With default vars, the state path and artifacts stay identical to today (invariant V1).
- [ ] R2. When `auto` is true and `outline` is empty, outline-write routes to a new `outline-autopick` state. The writer prompt writes `2-outline/outline-recommendation.json` `{pick, rationale}`. `kk stage itc-outline-pick <work_dir>` validates it, then `file.read.into-var` binds `outline` and the run goes to outline-commit without entering outline-select.
- [ ] R3. When `unslop` is true, a `unslop` agent.run step (`kk:taste-unslop`) edits `3-draft-draft-article.md` in place after draft-write and after each auto revision, before review or the judge.
- [ ] R4. When `auto` is true, draft-review is skipped and the judge always runs. On NEEDS_REVISION, `draft-autorevise` applies the verdict `feedback[]` and increments `.auto-revise-count`, and the run returns to the judge while the count is below `max_revisions`. FAIL or an exhausted budget routes to `report`, which ends in failed.
- [ ] R5. When `auto` is false, a NEEDS_REVISION verdict routes to draft-revise with the feedback shown, bounded by the existing `.revise-count` < 3. FAIL or an exhausted budget still ends in failed.
- [ ] R6. When `docs.json` exists, the judge prompt names it as evidence.
- [ ] R7. `kk stage itc-report <work_dir>` writes `5-report/report.md` and `5-report/report.json` `{{outcome, verdict, revisions}}`. The `report` state routes to done or failed on `outcome`. The stage exits 1 only when it cannot write.
- [ ] R8. Helpers live in `plugins/kk/scripts/itc-stages.ts`, are dispatched from the `kk-workflow-stages.ts` switch, and use only node builtins (ADR-018). Update `docs/04_DESIGN.md` for the new vars and stages in the same commit (T3).

### Acceptance Criteria

- [ ] AC1 — kk-itc with default vars keeps its current states and pauses
- [ ] AC2 — Auto mode commits the writer-recommended outline without pausing
- [ ] AC3 — Auto mode revises on judge feedback up to max_revisions
- [ ] AC4 — Interactive runs route NEEDS_REVISION back to draft revision
- [ ] AC5 — Judge receives research evidence when research ran
- [ ] AC6 — Unslop pass edits the draft before the judge runs

Task-local checks:
- The structural test pins every new edge guard.
- The dry-run walk with `auto` true reaches done.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-22T16:50:42.154Z

- **Q: Where do the new stage helpers live?** A (closed): in the sibling file `plugins/kk/scripts/itc-stages.ts`. They are dispatched from the stage switch at `plugins/kk/scripts/kk-workflow-stages.ts:1537`, next to `prepare-itc` (`:1538`). Reason: the shared runner is already more than 1.5k lines. The helpers use node builtins only (ADR-018, `docs/00_ADR.md:730`).
- **Q: How does auto mode skip outline selection?** A (closed): a guard on `auto == true` routes outline-write → outline-autopick (`kk stage itc-outline-pick`) → draft-write. The interactive path keeps its operator select action unchanged (`plugins/kk/workflows/kk-itc.yaml:76`).
- **Q: What caps the revise loops?** A (closed):
  - Auto uses `max_revisions` (default 2) through the agent revise state.
  - Interactive keeps the current cap of 3 (`kk-itc.yaml:234`, `:242`).
  - A NEEDS_REVISION verdict now routes to draft-revise instead of failed.
- **Q: How is an empty verdict file treated?** A (closed): as PASS, the same as today (`kk-itc.yaml:256`), so `--dry-run` walks can reach done. Real runs always write the verdict through `expectFile` (`kk-itc.yaml:148`).
- **Q: Where does the report read the revision count from?** A (closed): from the existing revise-count file (`kk-itc.yaml:129-130`). No new counter.
- **Deferred:** per-target publish outcomes in `itc-report` belong to 0151, which extends the stage this task creates.
- **Premises (verified):**
  - `kk-itc.yaml` today: draft-revise at `:122`, judge at `:136`, verdict file at `:148`.
  - The dry-run test pattern (unset `SPUR_WORKFLOW_RUN_ACTIVE`) is at `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:104,431,438`.
  - The existing structural tests are in `apps/cli/tests/kk-itc-workflow.test.ts`.
- **Dependencies:** none. This task goes first in F41's order.

### Design

Approach: extend `kk-itc.yaml` in place with var guards, following the edge table in `docs/design/kk-itc-end-to-end.md` §3. Deterministic checks go in `kk stage itc-*`. Reason: spur has no sub-workflow action, and kk owns steps while spur owns routing (ADR-021).

Rejected:
- A separate auto workflow file. It would duplicate the authoring states, which would then drift.
- Parsing the outline pick in YAML shell. That is untestable; a stage helper is unit-testable.

Invariants:
- V1: default vars mean today's path.
- V5: every loop is bounded (`max_revisions`, 3).
- An empty verdict still counts as PASS, so a `--dry-run` walk stays possible.

Signatures:
- `itc-outline-pick <work_dir>` → writes `2-outline/.auto-pick`. Exits 1 on a missing file, a pick outside a/b/c, or a missing option file.
- `itc-report <work_dir>` → `report.json` `{outcome:'done'|'failed', verdict, revisions, targets?}`.

### Plan

1. Add `itc-stages.ts` with `itc-outline-pick` and `itc-report`, dispatch them from `kk-workflow-stages.ts`, and write unit tests in `apps/cli/tests/itc-stages.test.ts`.
2. Add the vars and the outline-autopick, unslop, draft-autorevise and report states and edges to `kk-itc.yaml`. Update the writer and judge prompts.
3. Extend `apps/cli/tests/kk-itc-workflow.test.ts`: structural asserts for the §3 authoring edges, the default-path invariant and the loop caps, plus a `spur workflow run --dry-run` walk with `auto` true.
4. Sync `docs/04_DESIGN.md`, then run `bun run lint` and `bun run test`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Design: `docs/design/kk-itc-end-to-end.md`
- Decisions: `docs/00_ADR.md` ADR-021 (kk-itc end-to-end), ADR-022 (drafts by default; auto never implies live)
- Feature: F41 (`docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md`)
- Brainstorm: `docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`

### History
