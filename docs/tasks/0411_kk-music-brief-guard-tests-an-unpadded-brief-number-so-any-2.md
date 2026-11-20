---
schema_version: 1
name: kk-music brief guard tests an unpadded brief number, so any 2-direction run dies at the brief state
status: done
template: issue
created_at: 2026-11-20T17:09:32.500Z
updated_at: "2026-11-20T17:11:42.889Z"
feature_id: D8

done_forced: "true"
done_reason: "Fixed and tested in the 0404 dogfood batch: verified by plugins/kk/tests/kk-music-workflow.test.ts (22 pass) and by driving kk-music end to end (runs b964b82b…, be6fc51f…); no separate pipeline run launched for these two residuals."
---

## 0411. kk-music brief guard tests an unpadded brief number, so any 2-direction run dies at the brief state

### Background

Captured from the creation title: "kk-music brief guard tests an unpadded brief number, so any 2-direction run dies at the brief state".

### Requirements

- [ ] R1. The `brief` state's guard accepts the zero-padded brief files the workflow's own prompt coins (`brief-01..`), for a bare `directions` value as well as a padded one.
- [ ] R2. A regression test pins the guard shape, so a future edit cannot reintroduce the unpadded form.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. [ ] Fix the `brief` guard to accept both `brief-0<n>` and `brief-<n>`.
2. [ ] Pin it in `plugins/kk/tests/kk-music-workflow.test.ts`.
3. [ ] `bun run lint`, `bun test plugins/kk`.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

**Root cause.** `plugins/kk/workflows/kk-music.yaml` had the `brief` state's guard testing
`brief-${vars.directions}.yaml`, while the same state's agent prompt coins `brief-0<n>…`. With the
frozen `directions=2` the guard looked for `brief-2.yaml`, exited 1, and the engine marked the run
`failed` at `brief` — before `explore`, so no money and no take, but every 2-direction run was dead.
Observed end to end on 2026-11-20 (runs `ff668cc9…`, `1c952954…`).

**Change.**

| File | Change |
| --- | --- |
| `plugins/kk/workflows/kk-music.yaml` | the guard tests `brief-0$((${vars.directions})).yaml` and `.prompt.txt` — the padded names its own prompt produces, with the arithmetic normalizing a caller-passed `02` as well as `2`. Two `test -f` calls, inside ADR-115's budget. |
| `plugins/kk/tests/kk-music-workflow.test.ts` | pins the padded form and refuses a regression to the bare one. |

Verified with `/bin/sh` against a real run directory for both `directions=2` and `directions=02`, and
by the 0404 dogfood: the dry rehearsal and the paid explore both transitioned past `brief` afterwards.

### Testing

- `bun test plugins/kk/tests/kk-music-workflow.test.ts` → 22 pass, 0 fail (includes the new guard test).
- `/bin/sh -c 'test -f …/brief-0$((${__WF_1})).yaml && test -f …prompt.txt'` with `__WF_1=2` and
  `__WF_1=02` against a real run directory → exit 0 for both.
- End to end: `spur workflow run plugins/kk/workflows/kk-music.yaml --vars '{"directions":"2",…}'`
  now reaches `explore`/`select` instead of failing at `brief` (runs `b964b82b…`, `be6fc51f…`).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-11-20T17:11:41.398Z todo → wip (system)
- 2026-11-20T17:11:42.143Z wip → testing (system)
- 2026-11-20T17:11:42.882Z testing → done (system)

