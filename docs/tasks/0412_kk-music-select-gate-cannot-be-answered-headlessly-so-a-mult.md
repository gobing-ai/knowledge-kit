---
schema_version: 1
name: kk-music select gate cannot be answered headlessly, so a multi-take run can never pass its operator gate
status: done
template: issue
created_at: 2026-11-20T17:09:37.459Z
updated_at: "2026-11-20T17:11:44.683Z"
feature_id: D8

done_forced: "true"
done_reason: "Fixed and tested in the 0404 dogfood batch: verified by plugins/kk/tests/kk-music-workflow.test.ts (22 pass) and by driving kk-music end to end (runs b964b82b…, be6fc51f…); no separate pipeline run launched for these two residuals."
---

## 0412. kk-music select gate cannot be answered headlessly, so a multi-take run can never pass its operator gate

### Background

Captured from the creation title: "kk-music select gate cannot be answered headlessly, so a multi-take run can never pass its operator gate".

### Requirements

- [ ] R1. The `select` operator gate accepts a take number from a headless resume (`spur workflow continue --answer-text`), keeping the gate and the state's pause semantics intact.
- [ ] R2. `analyze` re-binds the selection from the answered value, because a resume skips the paused state's own actions (`resumeMode: skip-enter`).
- [ ] R3. A regression test pins the gate kind and the binding call.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. [ ] Switch the gate to `hitl.input` and pass `${vars.__hitlAnswer}` into `music-select` from both `select` and `analyze`.
2. [ ] Update `plugins/kk/tests/kk-music-workflow.test.ts`.
3. [ ] `bun run lint`, `bun test plugins/kk`.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

**Root cause (two halves of one dead gate).** `select` used `hitl.select` with options `01..04`, but
`spur workflow continue --answer` accepts only `yes|no|cancel` (validation in the CLI), and
`--answer-text` is refused for anything but `hitl.input` — so a headless resume had no way to deliver a
take number. Worse, a resume of a paused run uses `resumeMode: skip-enter`, so `select`'s own
`music-select` binding never re-runs, leaving `3-takes/selection.json` unwritten for `analyze`.

**Change.**

| File | Change |
| --- | --- |
| `plugins/kk/workflows/kk-music.yaml` | the gate is now `hitl.input` (free text carries the take number) with the same `pause: true` operator pause; `select` and `analyze` both bind through `music-select "${vars.__hitlAnswer}"`, so whichever pass runs after the resume writes the selection. |
| `plugins/kk/tests/kk-music-workflow.test.ts` | pins `select` as the only pause state, the `hitl.input` kind, and the `__hitlAnswer` binding in both states. |

The gate semantics are unchanged: the run still stops and waits for a human, `auto` still skips it only
on the single-take route, and `music-select` still validates the number against an authored brief and
an on-disk take.

**Not changed:** the `spur` CLI's `--answer` validation. That is an engine-side restriction; this
workflow-side shape is answerable without it.

### Testing

- `bun test plugins/kk/tests/kk-music-workflow.test.ts` → 22 pass, 0 fail.
- End to end on 2026-11-20 (0404 dogfood): `spur workflow continue <run> --answer-text 01 --yes`
  advanced `select` → `analyze` → `check` (dry run) and `select` → `explore`-bound selection on the
  paid run, i.e. the gate is now answerable headlessly and the selection is written.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-20T17:11:43.211Z todo → wip (system)
- 2026-11-20T17:11:43.948Z wip → testing (system)
- 2026-11-20T17:11:44.676Z testing → done (system)

