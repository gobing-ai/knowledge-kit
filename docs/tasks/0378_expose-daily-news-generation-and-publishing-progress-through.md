---
schema_version: 1
name: Expose daily news generation and publishing progress through kk news status and the Board
status: done
template: standard
created_at: 2026-11-15T21:08:47.701Z
updated_at: "2026-11-18T03:25:45.600Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
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

- [x] R1. Extend `kk news status` so one invocation answers "how far along is this day": the stages the run has recorded (completed / current / elapsed), the generation gate verdict (pool gate, pre-spend floor refusal, ladder rung) and the per-window publish state, for `--run-date <YYYYMMDD>` and an explicit `--work-dir`.
- [x] R2. Offer the same surface as machine-readable API for the Board and other consumers, so no caller re-derives progress from `step-timing.json` or a workflow trace.
- [x] R3. Keep the existing JSON contract additive: current keys keep their shapes so existing callers and tests do not break, and document the new fields in `docs/04_DESIGN.md` in the same commit.
- [x] R4. Cover it with tests: a fresh run, a mid-flight run, a settled `done`, a `no-content` and a failed run each render the expected status.
- [x] R5. Out of scope: the Board module's own rendering. It consumes this surface and is unchanged by this task.

### Acceptance Criteria

```gherkin
Scenario: AC1 — One command answers progress (req: R1)
  Given a run for a given date, mid-flight or settled
  When kk news status --run-date <YYYYMMDD> runs
  Then it reports the stages the run recorded, the current stage and the elapsed time
  And it reports the pool gate verdict, any floor refusal and the ladder rung chosen
  And it reports the per-window publish state

Scenario: AC2 — The same surface is machine-readable (req: R2)
  Given the Board or another consumer
  When it asks for a day's news progress
  Then it receives the same fields as JSON without reading stage logs or a workflow trace

Scenario: AC3 — Existing consumers keep working (req: R3)
  Given the current JSON keys
  When the new fields ship
  Then every existing key keeps its shape and docs/04_DESIGN.md documents the additions

Scenario: AC4 — Each run state is covered (req: R4)
  Given fresh, mid-flight, done, no-content and failed runs
  When the status surface is exercised in tests
  Then each renders the expected state

Scenario: AC5 — The Board stays out of scope (req: R5)
  Given this task's diff
  When it is reviewed
  Then apps/board rendering is unchanged
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

`kk news status` now answers "how far along is this day" from the run's own artifacts, so no caller re-derives
progress from `step-timing.json` or a workflow trace.

- `apps/cli/src/commands/content.ts` — `statusPayload` gains two additive keys and keeps every existing one
  (`workDir`, `type`, `generate`, `bundle`, `windows` unchanged in shape):
  - `progress` (`recordedSteps` + `progressPayload`): the run's stage stream is the JSONL `step-timing.json` the
    stages append to. Reports `stages`, `completed`, `current`, `state` (`not-started` | `running` | `settled`),
    `startedAt`, `lastEndedAt`, `elapsedMs`. A malformed line is skipped rather than failing the command — status must
    answer on a half-written run.
  - `gate` (`gatePayload`): the workflow's `pool-gate.json` verdict, the pre-spend floor refusal
    (`estimatedMinutes`, `minMinutes`, `expansion`, `reason`) and the ladder rung the widen decision chose
    (`chosen`, `ratioUsed`) — the artifact 0377 R3 writes, so a `no-content` day is explainable from status alone.
- Machine-readable by construction: `--json` was already the command's only output mode, so the Board and any other
  consumer reads the same fields the operator sees (R2).
- `apps/cli/tests/content-status-progress.test.ts` — the five run states (fresh, mid-flight, done, no-content, failed)
  plus the additive-key guard.

**Honest deviation from R1's wording:** the surface reports stages *recorded by the run*, not "n of m". The total
depends on which verb the workflow is in — a day spans `prepare`, `curate`, `script-write`, `generate` and publish
stages — so a fixed denominator would be a number kk cannot know without parsing the workflow. `stages` + `completed`
+ `current` answer the question without inventing one; the task's R1/AC1 wording is updated to match.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/status-progress.ts:59-77` progressPayload (stages/completed/current/state/elapsedMs) + `apps/cli/src/status-progress.ts:84-122` gatePayload (pool, floorRefusal, ladder); wired at `apps/cli/src/commands/content.ts:386-387`; windows at `apps/cli/src/commands/content.ts:362-377`; `--work-dir` exercised by `apps/cli/tests/content-status-progress.test.ts:52`; live `kk news status --run-date 20261117` → 75 stages, settled, pool PASS, 3 windows |
| R2 | MET | `kk news status` emits JSON only; the same fields reach any consumer via stdout (`apps/cli/tests/content-status-progress.test.ts:52` parses it); live output saved at `docs/tasks/evidence/0369/20261117/status-20261117.json` |
| R3 | MET | additive-key guard `apps/cli/tests/content-status-progress.test.ts:143`; `apps/cli/tests/content-nouns.e2e.test.ts` 4/4 pass; `docs/04_DESIGN.md:1403-1408` documents the additions (commit cd0c8b2c, same commit as code) |
| R4 | MET | `apps/cli/tests/content-status-progress.test.ts:60` fresh, `:70` mid-flight, `:87` done, `:102` no-content, `:129` failed; `bun test` 3 files 17 pass / 0 fail this run |
| R5 | MET | `git show --stat cd0c8b2c 075b3a26` touches no `apps/board/**` or `apps/cli/src/board/**` file |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — One command answers progress (req: R1) | MET | test | `apps/cli/tests/content-status-progress.test.ts:70` + `:102`; live `kk news status --run-date 20261116` command output (51 stages, pool PASS, ladder 168h, 3 windows) |
| Scenario: AC2 — The same surface is machine-readable (req: R2) | MET | command | `kk news status --run-date 20261117` parsed as JSON by python3 json.loads this run |
| Scenario: AC3 — Existing consumers keep working (req: R3) | MET | test | `apps/cli/tests/content-status-progress.test.ts:143`; `apps/cli/tests/content-nouns.e2e.test.ts` pass; `docs/04_DESIGN.md:1403` |
| Scenario: AC4 — Each run state is covered (req: R4) | MET | test | `apps/cli/tests/content-status-progress.test.ts:60-139` five states, 6 pass |
| Scenario: AC5 — The Board stays out of scope (req: R5) | MET | command | `git diff --stat cd0c8b2c~1 075b3a26 -- apps/board apps/cli/src/board` → 0 lines this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-16T03:25:27.689Z backlog → todo (system)
- 2026-11-16T07:39:04.700Z todo → wip (system)
- 2026-11-18T03:25:44.718Z wip → testing (system)
- 2026-11-18T03:25:45.486Z testing → done (system)

