---
schema_version: 1
name: Docs sync for the kk-itc end-to-end contract
status: todo
template: feature-impl
created_at: 2026-09-22T16:46:32.548Z
updated_at: "2026-09-22T16:51:23.936Z"
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

- [ ] R1. In `docs/00_ADR.md`, change ADR-021 and ADR-022 from `Accepted (design)` to `Accepted`, with the ship date. In `docs/04_DESIGN.md`, change the kk-itc-end-to-end index row status to shipped, and update the §7 workflow table row for the kk-itc artifacts.
- [ ] R2. The `docs/01_PRD.md` deferral row for the image, research, adaptation and publishing families is updated to point at F41. `docs/05_FEATURES.md` records the F41 status. `docs/design/itc-generating.md` links to the end-to-end design.
- [ ] R3. The surface guard is verified: `kk --help` lists the same top-level commands, and `git diff --name-status` for `plugins/kk/workflows` and `plugins/kk/commands` since the F41 start shows modifications only, with no added files.
- [ ] R4. `bun run gate` passes.

### Acceptance Criteria

- [ ] AC1 — The feature adds no workflow file, kk noun or slash command
- [ ] AC2 — Docs record the widened kk-itc contract and the draft-default publish rule

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
