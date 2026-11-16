---
schema_version: 1
name: The deferred gate cannot reach its repair lane and taxes every worktree run
status: todo
template: issue
created_at: 2026-11-16T04:13:07.532Z
updated_at: "2026-11-16T04:13:22.955Z"

---

## 0383. The deferred gate cannot reach its repair lane and taxes every worktree run

### Background

Collected across two `/sp-dev-run` and one `/sp-dev-runall` execution on 2026-11-15/16, all reproduced more than once
against spur's shared `task-pipeline.yaml` v9. These are upstream (`@gobing-ai/spur`) defects, recorded here because they
taxed this repo's every worktree run; each blocked a real task's repair lane or forced a 25-minute full suite.

1. **The deferred gate writes no findings file, so `remediate` can never run.** With `deferQualityGate: true` the gate
   runs the light tier and writes `.spur/run/<wbs>-test-gate.status` (`DEFERRED`/`FAIL`) — but `runDeferredGate` never
   writes `.spur/run/<wbs>-test-gate.findings`, while the `remediate` state's first action is a hard
   `file.read.into-var` on that path. A red light gate therefore ends the run with
   `file.read.into-var: file not found: .spur/run/<wbs>-test-gate.findings` instead of entering the bounded fix lane.
   Observed on 0379 (first run), 0376 and 0381.
2. **The light gate's format-lint step fails when the whole changed set is Biome-ignored.** `runLightGate` runs
   `biome check` over the changed paths; this repo's `biome.json` ignores `docs/**`, so a docs-only task (three task
   files) makes Biome exit non-zero with `No files were processed in the specified paths`, which the gate reads as a
   task failure. Every docs-only task is ungateable.
3. **The coverage rule exits 1 when no lcov exists.** `recommended-post-check`'s `coverage-gate` prints
   `No lcov file found — coverage not generated. Skipping gate.` and still exits 1, so a fresh `--worktree` — which has
   no `.coverage/` — fails `rules:post` until a full `bun run test` (≈25 min here) writes one. Observed on 0379 and
   again on the 0376/0381 batch.

### Requirements

- [ ] R1. A red deferred gate hands the `remediate` hop a findings file — a 0-byte one when the failing tier produced no anchors — so `/sp:dev-fixall` runs instead of the run dying on `file.read.into-var: file not found`.
- [ ] R2. The light gate treats "every changed path is ignored by the formatter" as nothing-to-check (recorded as such), not as a task failure, while a genuine formatter error still fails.
- [ ] R3. The coverage rule records an explicit `unknown`/skipped outcome when no lcov exists instead of exiting 1, so a fresh worktree is not blocked by an artifact it has not generated yet.
- [ ] R4. Each of the three reads as a recorded, explainable outcome in the run report — no silent pass — and a regression test pins the deferred-gate findings handoff and the ignored-paths case.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
