---
schema_version: 1
name: Docs sync for the kk-itc end-to-end contract
status: done
template: feature-impl
created_at: 2026-09-22T16:46:32.548Z
updated_at: "2026-09-22T23:29:10.247Z"
feature_id: F41
priority: P2
tags:
  - F41
  - kk-itc
estimate_hours: 2.5

dependencies: ["0149", "0150", "0151", "0152", "0153"]
---

## 0154. Docs sync for the kk-itc end-to-end contract

### Background

This is the closing documentation sweep for F41. It marks ADR-021 and ADR-022 as shipped, lifts the PRD deferral, records the feature status, and confirms the surface guard (no new workflow file, kk noun or slash command).

Implements:
- R19 — The feature adds no workflow file, kk noun or slash command
- R20 — Docs record the widened kk-itc contract and the draft-default publish rule

Design SSOT: `docs/design/kk-itc-end-to-end.md`. Ordering: last, after every other F41 task.

Rubric: E2.5 D1 L1 C0 R0 = 4.5 → kept as its own task because it verifies the whole feature's docs and surface.

### Requirements

- [x] R1. In `docs/00_ADR.md`, change ADR-021 and ADR-022 from `Accepted (design)` to `Accepted`, with the ship date. In `docs/04_DESIGN.md`, change the kk-itc-end-to-end index row status to shipped, and update the §7 workflow table row for the kk-itc artifacts.
- [x] R2. The `docs/01_PRD.md` deferral row for the image, research, adaptation and publishing families is updated to point at F41. `docs/05_FEATURES.md` records the F41 status. `docs/design/itc-generating.md` links to the end-to-end design.
- [x] R3. The surface guard is verified: `kk --help` lists the same top-level commands, and `git diff --name-status` for `plugins/kk/workflows` and `plugins/kk/commands` since the F41 start shows modifications only, with no added files.
- [x] R4. `bun run gate` passes.

### Acceptance Criteria

- [x] AC1 — The feature adds no workflow file, kk noun or slash command
- [x] AC2 — Docs record the widened kk-itc contract and the draft-default publish rule

Task-local check: `bun run gate` is green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-22T16:50:45.936Z

- **Q: Which ADR edits are allowed?** A (closed): only the status and date of ADR-021 (`docs/00_ADR.md:857`) and ADR-022 (`:875`), from "Accepted (design)" to "Accepted". The Decision text is not changed.
- **Q: Is the live smoke run required?** A (closed): no. It is optional, needs an explicit operator go-ahead at execution time, and publishes to one draft target. Neither the AC nor `bun run gate` depends on it.
- **Q: How is the surface guard (R19) checked?** A (closed):
  - Compare the `kk --help` top-level commands against executor, plugin and stage.
  - Confirm that `plugins/kk/workflows` and `plugins/kk/commands` gained no new files in the F41 change set (`git diff --name-status --diff-filter=A`).
- **Premises (verified):** the PRD deferral row this closes is `docs/01_PRD.md:86` ("Remaining WT agent-skill families": image, auxiliary research, adaptation, publishing).
- **Dependencies:** 0149–0153. Docs sync runs last.

### Design

Approach: a docs-only sweep that follows constitution order: `00` first, then the derived docs `01`, `04`, `05` and the design satellites.

Rejected: folding this into the implementing tasks. Each of those already syncs its own `04` surface under T3. This task owns the status flips and the cross-feature checks.

Invariant: no edits to the ADR Decision text, only the status and date.

### Plan

1. Flip the ADR statuses and the 04 index and workflow rows.
2. Update the 01 deferral row and the 05 status, and add the itc-generating link.
3. Run the surface guard checks and `bun run gate`.
4. Optional, and only with an explicit operator go-ahead: a live smoke run to one draft target, recorded as evidence.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/tests/kk-itc-workflow.test.ts:106` |
| `apps/cli/tests/kk-itc-workflow.test.ts:2` |
| `apps/cli/tests/workflow-run-command.test.ts:196` |
| `plugins/kk/scripts/kk-workflow-stages.ts:15` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1673` |
| `plugins/kk/scripts/kk-workflow-stages.ts:1710` |
| `plugins/kk/scripts/kk-workflow-stages.ts:26` |
| `plugins/kk/scripts/kk-workflow-stages.ts:74` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | docs/00_ADR.md:859 (ADR-021 "**Status:** Accepted · **Date:** 2026-09-22 (feature F41, shipped)") and docs/00_ADR.md:877 (ADR-022 same flip) — diff touches only the Status line per ADR, Decision text untouched (Q&A invariant held); docs/04_DESIGN.md:46 index row → "shipped (F41)"; §7.2 workflow/profile table kk-itc row updated with publish-tail artifacts + "F41 shipped 2026-09-22" docs/04_DESIGN.md:629 (§6 satellite row also updated docs/04_DESIGN.md:586) |
| R2 | MET | docs/01_PRD.md:86 deferral row → "**F41** |
| R3 | MET | Command (fresh): kk --help lists exactly executor / plugin / stage / help — no new top-level noun. Command: git diff 58264f7b --name-status -- plugins/kk/workflows plugins/kk/commands → M plugins/kk/commands/workflow-run.md, M plugins/kk/workflows/kk-itc.yaml; no A rows. git status --porcelain for both dirs → modifications only; sole surface-adjacent untracked path is plugins/kk/skills/article-adapt/ (agent-invoked skill, not a workflow file / kk noun / slash command) |
| R4 | MET | Command (fresh): bun run gate → 1231 pass / 0 fail across 82 files, 4865 expect() calls (86.68s), format+build clean; spur rule run --preset recommended-post-check --fail-on warning → "All 2 rules passed — no violations found." |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | kk --help (top-level commands unchanged: executor/plugin/stage) + git diff 58264f7b --name-status plugins/kk/workflows plugins/kk/commands → M only, zero added files; untracked inventory confirms no new workflow file or command; claim echoed in docs/05_FEATURES.md:85 "(verified 0154)" |
| AC2 | MET | command | docs/04_DESIGN.md:635 records the widened contract incl. draft-default rule verbatim ("publish_live (false; live is never implied by auto)", publish-confirm HITL skipped only when auto ∧ ¬publish_live, ADR-022); docs/04_DESIGN.md:639 records --live binding only when explicitly passed; ADR-022 docs/00_ADR.md:877; command backing: bun run gate green includes kk-itc-publish-tail/kk-itc-workflow tests pinning draft-default behavior; grep confirms the recorded phrases at cited lines |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0154 (docs sync, F41 closing sweep)

**Scope:** uncommitted working-tree diff vs HEAD (18 files, +1334/−106) against this task's R1–R4 / AC1–AC2.
**Dimensions:** functional traceability, SECUA, architecture. Reviewer ran fresh checks; no code edited.
**Verdict:** PASS (APPROVED) — 0 blocker · 0 major · 1 minor · 1 advisory

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
|---|----------|-----------|---------|----------|
| 1 | P3 (minor) | correctness | Same-diff status divergence: `05_FEATURES.md` claims F41 "✅ done; tasks 0149–0154 done" while the F41 feature file still shows `status: active`, 0149 `testing`, 0150–0154 `todo` (stale AUTO-GENERATED table). Substantively not an overclaim — code+tests for 0149–0153 verified present and gate green — but `spur feature refresh` + lifecycle close must reconcile before the run merges. | `docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md:5,255-261` vs `docs/05_FEATURES.md:85` |
| 2 | P4 (advisory) | usability | 0154's own Solution/Testing sections remain unfilled in this task file; the run brief routes evidence to Review instead. Lifecycle close (wip → done) will backfill. | `docs/tasks/0154_*.md` Solution/Testing |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | ADR-021 `docs/00_ADR.md:859` and ADR-022 `:877` flipped to `Accepted` with ship date; Decision text untouched (Q&A invariant held — diff touches only the Status line per ADR). 04 index row → shipped `docs/04_DESIGN.md:46`; §7 workflow-table kk-itc row updated with tail artifacts + report outputs `docs/04_DESIGN.md:629`; §7 command surface gained the 0153 flags `:619-620`. |
| R2 | MET | PRD deferral row → F41 Shipped `docs/01_PRD.md:86`; 05 records F41 status `docs/05_FEATURES.md:85`; `docs/design/itc-generating.md:15` links to `kk-itc-end-to-end.md`. |
| R3 | MET | `kk --help` lists executor / plugin / stage only — no new top-level noun. `git diff --name-status plugins/kk/workflows plugins/kk/commands` vs F41 start (HEAD `58264f7b`) = M only, no added files. New `plugins/kk/skills/article-adapt/SKILL.md` is an agent-invoked skill, not a kk noun/slash command/workflow file — within the R19 guard and claimed as such in 04. |
| R4 | MET | Fresh `bun run gate`: 1231 pass / 0 fail across 82 files (93.97s); `spur rule run --preset recommended-post-check --fail-on warning`: all rules passed. |

**AC1 (no new workflow file / kk noun / slash command):** MET — see R3. **AC2 (widened contract + draft-default rule recorded):** MET — ADR-022 `:877` and 04 §kk-itc paragraphs `docs/04_DESIGN.md:631-635` record the tail and the `publish_live` never-implied rule.

##### Shipped-claim honesty (scope note)

Every "shipped" claim traces to real code+tests: all seven helpers exist and dispatch (`plugins/kk/scripts/itc-stages.ts:537-560`, re-exported via `kk-workflow-stages.ts:1673-1703`); workflow states/vars present (`plugins/kk/workflows/kk-itc.yaml`: `publish-confirm` at `:245`, `.publish-declined` write at `:258`, auto/unslop/judge var gates at `:360-488`); 0153 flag bindings match `plugins/kk/commands/workflow-run.md:39-41,193-198`; test coverage real (34 + 3 + 23 + 22 `it()` blocks across `itc-stages.test.ts`, `kk-itc-publish-tail.test.ts`, `kk-itc-workflow.test.ts`, `workflow-run-command.test.ts`, all green in gate). The 04 §7 narrative paragraphs match the implementation state-for-state.

##### Architecture notes

Docs-only diff; the documented surface (var-gated states + `itc-*` stage helpers + thin `kk:article-adapt` skill) keeps the skill plan-SSOT-driven and switch-stamping in `itc-publish-fanout` — consistent with ADR-021/022 as written. No architectural findings.

**Residual risk:** the P3 status divergence above; optional live smoke run remains unexecuted (allowed — Q&A closed it as optional, no AC depends on it).

### References

- Design: `docs/design/kk-itc-end-to-end.md`
- Decisions: `docs/00_ADR.md` ADR-021 (kk-itc end-to-end), ADR-022 (drafts by default; auto never implies live)
- Feature: F41 (`docs/features/F41_kk-itc-end-to-end-rough-idea-to-multi-platform-publish-hitl-and-auto.md`)
- Brainstorm: `docs/plans/2026-09-21-itc-end-to-end-publish-brainstorm.md`

### History

- 2026-09-22T23:15:23.378Z todo → wip (system)
- 2026-09-22T23:29:09.406Z wip → testing (system)
- 2026-09-22T23:29:10.247Z testing → done (system)

