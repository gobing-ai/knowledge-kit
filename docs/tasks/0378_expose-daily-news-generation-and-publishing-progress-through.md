---
schema_version: 1
name: Expose daily news generation and publishing progress through kk news status and the Board
status: backlog
template: standard
created_at: 2026-11-15T21:08:47.701Z
updated_at: "2026-11-15T21:09:23.594Z"

ac_altitude: task-local
ac_numbering: task-local
---

## 0378. Expose daily news generation and publishing progress through kk news status and the Board

### Background

Today the only ways to see how a daily news run is doing are indirect, and the one UI that should show it
looks at a retired workflow.

What exists on 2026-11-15:

- `kk news status --run-date <YYYYMMDD>` prints one JSON object: `generate.status`, `generate.runId`,
  `executor`, `checkoutCommit`, `bundle`, `windows`. No stage progress, no elapsed time, no publish row
  state. Its `--window` flag changes nothing in the output shape for a windowed run.
- Progress requires a second command with a run id copied from the first:
  `spur workflow trace "$(kk news status --run-date 20261115 | jq -r '.generate.runId')"`.
- `apps/cli/src/board/daily-voice.ts:683` gates on `workflowFamily(workflow) !== 'kk-daily-ai-voice2'`, so
  `http://127.0.0.1:3003/board/daily-voice` still reads the **retired** `.works/kk-daily-ai-voice2/` tree
  and shows nothing for `.works/kk-news-generate/<day>/`. Its artifact map (`:211`) is likewise keyed to
  the voice2 stage names.
- `kk news status --run-date 20261114` answers `content run directory does not exist` for a day that has a
  complete tree, because that tree is `kk-daily-ai-voice2/20261114`.
- `/api/runs` lists workflow runs (`id`, `workflowName`, `status`, `startedAt`) but has no news-specific
  projection: no bundle/window state and no stage position.

The gap matters operationally: judging whether today's episode will publish means reading
`step-timing.json`, `pool-gate.json`, `30-audio/*duration-refusal.json` and the workflow trace by hand.

### Requirements

- [ ] R1. Extend `kk news status` so one invocation answers "how far along is this day": generation stage position (n of m, current stage name, elapsed), gate verdict, bundle presence, and per-window publish state (planned / awaiting approval / sending / settled) for `--run-date <YYYYMMDD>` and an explicit `--work-dir`.
- [ ] R2. Offer the same surface as machine-readable API for the Board and other consumers, so no caller re-derives progress from `step-timing.json` or a workflow trace.
- [ ] R3. Point the Board's daily-voice module at the current workflow family and run layout (`kk-news-generate`, phase directories `10-collect`…`5-report`, `pool-gate.json`, `schedule-receipt.json`), replacing the `kk-daily-ai-voice2` gate and artifact map, and show a retired-layout day without claiming it has no run.
- [ ] R4. Keep the existing JSON contract additive: current keys keep their shapes so existing callers and tests do not break, and document the new fields in `docs/04_DESIGN.md` in the same commit.
- [ ] R5. Cover it with tests: a fresh run, a mid-flight run, a settled `done`, a `no-content` and a failed run each render the expected status, and the Board module returns the current-layout tree for today's run.

### Acceptance Criteria

```gherkin
Scenario: AC1 — One command answers progress (req: R1)
  Given a run for a given date, mid-flight or settled
  When kk news status --run-date <YYYYMMDD> runs
  Then it reports the current stage position, elapsed time, gate verdict, bundle presence and per-window publish state

Scenario: AC2 — The same surface is machine-readable (req: R2)
  Given the Board or another consumer
  When it asks for a day's news progress
  Then it receives the same fields as JSON without reading stage logs or a workflow trace

Scenario: AC3 — The Board shows the current layout (req: R3)
  Given a day that ran under kk-news-generate
  When /board/daily-voice renders
  Then it lists that run with its phases, and a day that only ran under the retired layout is shown as retired rather than missing

Scenario: AC4 — Existing consumers keep working (req: R4)
  Given the current JSON keys
  When the new fields ship
  Then every existing key keeps its shape and docs/04_DESIGN.md documents the additions

Scenario: AC5 — Each run state is covered (req: R5)
  Given fresh, mid-flight, done, no-content and failed runs
  When the status surface is exercised in tests
  Then each renders the expected state and the Board module resolves today's run directory
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

1. Inventory the current `kk news status` shape and its callers (`apps/cli/src/commands/*status*`, board reader).
2. Add the progress fields additively (stage position from `step-timing.json` + workflow state, gate verdict
   from `pool-gate.json`, bundle presence, per-window state) and expose the same projection over the API.
3. Repoint `apps/cli/src/board/daily-voice.ts` at `kk-news-generate` and the phase-directory layout.
4. Update `docs/04_DESIGN.md` for the surface in the same commit.
5. Tests per run state; verify the Board page against today's real run.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
