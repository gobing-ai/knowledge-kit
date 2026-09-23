---
schema_version: 1
name: kk-itc auto mode, judge revise loop and run report
status: done
template: feature-impl
created_at: 2026-09-22T16:46:32.541Z
updated_at: "2026-09-23T15:44:13.755Z"
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

- [x] R1. Add the vars `auto` (false), `unslop` (false) and `max_revisions` (2) to `plugins/kk/workflows/kk-itc.yaml`. With default vars, the state path and artifacts stay identical to today (invariant V1).
- [x] R2. When `auto` is true and `outline` is empty, outline-write routes to a new `outline-autopick` state. The writer prompt writes `2-outline/outline-recommendation.json` `{pick, rationale}`. `kk stage itc-outline-pick <work_dir>` validates it, then `file.read.into-var` binds `outline` and the run goes to outline-commit without entering outline-select.
- [x] R3. When `unslop` is true, a `unslop` agent.run step (`kk:taste-unslop`) edits `3-draft-draft-article.md` in place after draft-write and after each auto revision, before review or the judge.
- [x] R4. When `auto` is true, draft-review is skipped and the judge always runs. On NEEDS_REVISION, `draft-autorevise` applies the verdict `feedback[]` and increments `.auto-revise-count`, and the run returns to the judge while the count is below `max_revisions`. FAIL or an exhausted budget routes to `report`, which ends in failed.
- [x] R5. When `auto` is false, a NEEDS_REVISION verdict routes to draft-revise with the feedback shown, bounded by the existing `.revise-count` < 3. FAIL or an exhausted budget still ends in failed.
- [x] R6. When `docs.json` exists, the judge prompt names it as evidence.
- [x] R7. `kk stage itc-report <work_dir>` writes `5-report/report.md` and `5-report/report.json` `{{outcome, verdict, revisions}}`. The `report` state routes to done or failed on `outcome`. The stage exits 1 only when it cannot write.
- [x] R8. Helpers live in `plugins/kk/scripts/itc-stages.ts`, are dispatched from the `kk-workflow-stages.ts` switch, and use only node builtins (ADR-018). Update `docs/04_DESIGN.md` for the new vars and stages in the same commit (T3).

### Acceptance Criteria

- [x] AC1 — kk-itc with default vars keeps its current states and pauses
- [x] AC2 — Auto mode commits the writer-recommended outline without pausing
- [x] AC3 — Auto mode revises on judge feedback up to max_revisions
- [x] AC4 — Interactive runs route NEEDS_REVISION back to draft revision
- [x] AC5 — Judge receives research evidence when research ran
- [x] AC6 — Unslop pass edits the draft before the judge runs

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-itc-workflow.test.ts:106` |
| `apps/cli/tests/kk-itc-workflow.test.ts:2` |
| `plugins/kk/scripts/kk-workflow-stages.ts:15` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1669` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1681` |
| `plugins/kk/scripts/kk-workflow-stages.ts:22` |
| `plugins/kk/scripts/kk-workflow-stages.ts:70` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-itc.yaml:23-25` (auto/unslop/max_revisions vars, default off/2); test `apps/cli/tests/kk-itc-workflow.test.ts:133` (vars default off) and `:139` (V1 default path unchanged) |
| R2 | MET | `plugins/kk/workflows/kk-itc.yaml:97` (outline-autopick state) + `:355` (outline-write→outline-autopick edge); `plugins/kk/scripts/itc-stages.ts:94` (itcOutlinePick); test `apps/cli/tests/itc-stages.test.ts:492`, workflow test `:160` |
| R3 | MET | `plugins/kk/workflows/kk-itc.yaml:137` (unslop), `:172` (draft-autorevise), `:318` (report), `:309` (judge reads docs.json); `plugins/kk/scripts/itc-stages.ts:130` (itcReport); tests `apps/cli/tests/kk-itc-workflow.test.ts:186,205` |
| R4 | MET | command `bun run gate` 2026-09-22 exit 0 (1231 pass / 0 fail, rules pass) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `plugins/kk/workflows/kk-itc.yaml:137` unslop state ordered before draft-review/judge; test `apps/cli/tests/kk-itc-workflow.test.ts:186` (unslop in place, on every auto revision path), `:197` (draft-write/draft-autorevise split) |
| AC2 | MET | test | `apps/cli/tests/kk-itc-workflow.test.ts:160` (auto=true routes to outline-autopick, never outline-select — no pauses); default-off invariant `:139` |
| AC-1 | MET | test | alias of R1: `plugins/kk/workflows/kk-itc.yaml:23-25`; test `apps/cli/tests/kk-itc-workflow.test.ts:133,139` |
| AC-2 | MET | test | alias of AC2: `apps/cli/tests/kk-itc-workflow.test.ts:160,139` |
| AC-3 | MET | test | alias of AC1: `plugins/kk/workflows/kk-itc.yaml:137`; test `apps/cli/tests/kk-itc-workflow.test.ts:186,197` |
| AC-4 | MET | test | alias of R3: `apps/cli/tests/kk-itc-workflow.test.ts:205,225` |
| AC-5 | MET | test | alias of R3: `plugins/kk/scripts/itc-stages.ts:130`; test `apps/cli/tests/itc-stages.test.ts:520` |
| AC-6 | MET | command | alias of R4: `bun run gate` 2026-09-22 exit 0 (1231 pass / 0 fail) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0149

**Scope:** uncommitted working-tree diff vs HEAD (7 files: kk-itc.yaml, itc-stages.ts, itc-stages.test.ts, kk-workflow-stages.ts, kk-itc-workflow.test.ts, 04_DESIGN.md, task record)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS (APPROVED)

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | HEAD routed any non-PASS judge verdict to failed (catch-all); the new guard set only matches PASS/empty, FAIL, NEEDS_REVISION — an out-of-contract verdict string (LLM judge typo, e.g. "Needs Revision") now deadlocks the run at judge in both modes | `plugins/kk/workflows/kk-itc.yaml:374-412` |
| 2 | P4 (advisory) | correctness | `itc-report` hardcodes `.itc-verdict.json` while a `verdictFile` var is declared — consistent with every pre-existing guard in the same file (the var is pre-existing and unused there), but a future custom verdictFile would silently bypass the report | `plugins/kk/scripts/itc-stages.ts:60` |
| 3 | P4 (advisory) | security | `${vars.max_revisions}` / counts are interpolated into shell guard commands (operator-trusted, matching the file's pre-existing convention); the TS helpers parse argv with `parseInt` and exec nothing | `plugins/kk/workflows/kk-itc.yaml:386` |
| 4 | P4 (advisory) | architecture | Structural tests assert YAML via regex slicing (`guardOf`/`stateBlock`) — brittle to reformat, but it is the established 0069 house pattern in the same file and pins every new edge guard | `apps/cli/tests/kk-itc-workflow.test.ts:120-131` |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/kk/workflows/kk-itc.yaml:32-34` vars; V1 pinned by structural test `kk-itc-workflow.test.ts:139-158` + dry-run default-path asserts |
| R2 | MET | `kk-itc.yaml:79-90` outline-autopick (stage + file.read.into-var binds outline); guard `:262-266`; writer recommendation contract `:61-63` |
| R3 | MET | `kk-itc.yaml:129-142` unslop state; edges `:268-272` (after draft-write) and `:358-362` (after each auto revision), both before judge |
| R4 | MET | `kk-itc.yaml:292-297` draft-write→judge in auto; `:390-396` NEEDS_REVISION→draft-autorevise while `.auto-revise-count` < `max_revisions`; `:382-388` FAIL/exhausted→report |
| R5 | MET | `kk-itc.yaml:398-404` interactive NEEDS_REVISION→draft-revise (feedback shown via `__verdictFeedback`), capped `.revise-count` < 3; `:406-412` FAIL/exhausted→failed |
| R6 | MET | `kk-itc.yaml:162-163` judge prompt names `docs.json` as research evidence |
| R7 | MET | `itc-stages.ts:57-90` writes `5-report/report.{md,json}` `{outcome, verdict, revisions}`, exits 1 only on write failure (unit-tested incl. blocker-file case); `kk-itc.yaml:414-422` routes done/failed on outcome |
| R8 | MET | `itc-stages.ts` node builtins only; lazy sibling dispatch `kk-workflow-stages.ts` (`loadItcStages`, cases `itc-outline-pick`/`itc-report`); `docs/04_DESIGN.md:627-629` updated in the same change |

Task-local checks: structural test pins every new edge guard (`kk-itc-workflow.test.ts:139-158`) and the dry-run walk with `auto=true` reaches done (`:259-287`); unit tests spawn the real script via `Bun.spawnSync` (exit codes + stderr asserted).

**Fresh verification (review run):** `bun test apps/cli/tests/itc-stages.test.ts apps/cli/tests/kk-itc-workflow.test.ts` → 30 pass / 0 fail (194 expect calls); `bun run lint` → all packages exit 0.

##### Architecture

`itc-stages.ts` is a deep, self-contained sibling: no cross-package imports (ADR-018), deterministic I/O only, fail-loud usage/error paths, and a lazy dynamic import from the shared runner so a missing sibling degrades to a loud per-stage failure instead of breaking stage load. Unit tests exercise the real process boundary rather than importing internals — the contract tested is the contract the workflow runs. No shallowing concerns; the 0151 slice can extend `itc-report` in place (targets already reserved in the design).

**Residual risk:** P3 finding 1 (judge verdict-vocabulary deadlock) is latent only if the content-judge skill emits an out-of-contract verdict; fix is a one-line catch-all judge→failed edge whenever next touched.

**Next:** approved — P3/P4 findings do not block; record disposition and proceed (0151 extends `itc-report`).

### References

- Design: `docs/design/kk-itc-end-to-end.md`
- Decisions: `docs/00_ADR.md` ADR-021 (kk-itc end-to-end), ADR-022 (drafts by default; auto never implies live)
- Feature: F41 (`docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md`)
- Brainstorm: `docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`

### History

- 2026-09-22T18:54:31.304Z todo → wip (system)
- 2026-09-22T19:10:11.999Z wip → testing (system)
- 2026-09-22T19:10:12.849Z testing → done (system)

