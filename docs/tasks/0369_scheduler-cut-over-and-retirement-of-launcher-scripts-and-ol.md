---
schema_version: 1
name: Scheduler cut-over and retirement of launcher scripts and old workflows
status: done
template: feature-impl
created_at: 2026-11-13T18:13:40.688Z
updated_at: "2026-11-15T04:01:31.968Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P2
dependencies: ["0366", "0367", "0368"]
done_forced: "false"
done_reason: unforced close
---

## 0369. Scheduler cut-over and retirement of launcher scripts and old workflows

### Background

Phase 4 of G61 (ADR-053 §2, §7). Frozen contract: `docs/design/content-pipeline-consolidation.md` §7 (retirement list and the three replacement scheduler lines) and §1.4 (hidden routes). After 0363–0368 the new verbs and workflows exist beside the old ones; the schedule still runs `bun scripts/daily-ai-news.ts …` (`.spur/config.yaml:151,176,188`) → `plugins/kk/scripts/daily-scheduled-run.ts` → voice3/publish3. This task switches the schedule, then deletes what it replaced.

**This task contains operator-gated steps.** Editing `.spur/config.yaml`, syncing a build into the installed package, re-enabling the scheduler, and every deletion require the operator's explicit go-ahead at the point marked in Plan. The scheduler is currently disabled by the operator (`scheduler.enabled: false`) — do not change that key.

Out of scope: `kk-daily-ai-voice.yaml`, `kk-daily-ai-voice2.yaml`, `kk-daily-safety.yaml`, stage bodies in `plugins/kk/scripts/daily-stages.ts` / `itc-stages.ts` / `kk-workflow-stages.ts`.

### Requirements

Re-scoped 2026-11-14 (operator decision "Split 0369"): the production-day evidence (was R3), the deletions (was R4) and the reference sweep (was R6) moved to task 0372, outside G61. Requirement ids are kept so earlier references stay valid.

- [x] R1. `.spur/config.yaml`: the `command` of jobs `kk-daily-ai-voice`, `kk-daily-publish3`, `kk-daily-publish3-cn-peak` becomes exactly the three lines in design §7. Job names, crons and every other key are unchanged.
- [x] R2. New `apps/cli/tests/schedule-no-scripts.e2e.test.ts`: for each of the three job commands, run it with a spawn recorder (stub `spur`, dummy publish) and assert no recorded argv contains `scripts/` or `plugins/kk/scripts/` as an entry script — i.e. no `bun <path under scripts>` process — and that each command resolves to exactly one `spur workflow run` per launch.
- [x] R5. `kk itc` and `kk daily` become hidden commands (`{ hidden: true }`, ADR-037) that still work; `kk --help` shows `article` and `news` and neither `itc` nor `daily`.
- [x] R7. Docs: `docs/04_DESIGN.md` §1.14 is the shipped surface — `kk itc` / `kk daily` marked hidden-compat, the scheduler lines recorded, the Board `--workflow` list carries the two new names. Doc passages that describe the old launchers stay until 0372 deletes them.
- [x] R8. Board and run-directory names: `apps/cli/src/board/manifest.ts` `WORKFLOW_NAMES` gains `kk-news-generate` and `kk-article-generate`, each reusing the existing artefact manifest and settings of `kk-daily-ai-voice2` / `kk-itc` (old names stay so historical runs still render); `board/reader.ts`, `board/daily-voice.ts` and `commands/board.ts` branch on the workflow family instead of the literal name; `daily-triage*.ts` resolves the run directory from `content_types.news.workflow` and falls back to `kk-daily-ai-voice2`. No Board feature work beyond the name mapping.
- [x] R9. `spur feature check G61` passes; `bun run gate` exits 0.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The scheduler runs without padding scripts (req: R1, R2)
  Given the scheduler entries for generate and both publish windows
  When each job command runs under the spawn recorder
  Then no process under `scripts/` or `plugins/kk/scripts/` appears in its recorded process tree
  And schedule-no-scripts.e2e.test.ts passes for all three job commands and writes .works/tmp/test-schedule/summary.json

Scenario: AC3 — Old spellings still answer, hidden (req: R5, R7)
  Given the change is applied
  When `kk --help`, `kk itc candidates --help` and `kk daily prepare --help` run
  Then help lists article and news, omits itc and daily, and the two hidden commands exit 0
  And docs/04_DESIGN.md §1.14 marks both as hidden compatible routes

Scenario: AC5 — Board and triage find the new run directories (req: R8)
  Given a run under <works>/kk-news-generate/<date> and an old run under <works>/kk-daily-ai-voice2/<date>
  When the Board manifest is asked for either workflow name and `kk daily triage` resolves a failed run
  Then both names yield the same artefact manifest and triage reads the kk-news-generate directory first

Scenario: AC4 — Gate (req: R9)
  Given the change is applied
  When `bun run gate` and `spur feature check G61` run
  Then both exit 0
```

### Q&A

- **Why is "the process tree" tested with a spawn recorder?** A real scheduled day cannot run in the gate. The recorder proves the commands' shape; R3's live-day evidence proves the real thing once. Both are required.
- **Stage bodies still load from `plugins/kk/scripts/` — does that violate the scenario?** No process is started from there: the `kk` binary imports the stage module in-process. The scenario and R2 are about entry scripts in the process tree. Stated here so nobody "fixes" it by moving 5,000 lines.
- **Which machine owns the schedule?** The Mac mini in production; the laptop for testing and rehearsal (operator decision 2026-11-13). Keep the schedule disabled on the laptop after rehearsal so two hosts never publish the same day — the per-day lock is per machine and does not protect across hosts.
- **Do old run directories move?** No. `kk-daily-ai-voice2/` and `kk-itc/` stay readable; R8 only adds the new names.
- **Rollback.** Until R4, rollback is reverting the three command lines. After R4 it is `git revert` of the deletion commit — keep the deletions in one commit separate from R1.
- **No secrets in evidence.** Receipts and status JSON only. Never paste environment blocks, launchd plists or cookies.

### Design

Owned files: `.spur/config.yaml` (three `command` values only), every path in R4, `apps/cli/src/commands/itc.ts` and `daily.ts` (hidden flag only), `apps/cli/src/index.ts` (registration), `apps/cli/tests/schedule-no-scripts.e2e.test.ts`, `docs/04_DESIGN.md`, `AGENTS.md`, `docs/design/kk-daily-ai-voice3.md`, `package.json`.

Three commits, in order: (1) schedule lines + e2e; (2) deletions; (3) hidden nouns + docs. Each is independently revertable.

### Plan

1. Write `schedule-no-scripts.e2e.test.ts`; confirm it fails against the old commands.
2. Apply R1 (operator-approved) and R8; build and sync the bundle and workflows into the installed package (operator-approved).
3. R5, R7.
4. `bun run gate`; `spur feature check G61`.

Mac mini production day, deletions and the sweep: task 0372.

### Solution

Non-gated half of the cut-over; deletions and production-day evidence are task 0372.

| Req | Change |
| --- | --- |
| R1 | `.spur/config.yaml:151`, `.spur/config.yaml:176`, `.spur/config.yaml:188` — the three `command` values are the design §7 lines; no other key touched (`scheduler.enabled` unchanged). |
| R2 | `apps/cli/tests/schedule-no-scripts.e2e.test.ts:34` — reads the commands from the checked-in config, runs each in the launch sandbox, asserts no `scripts/` path or `bun` spawn and one workflow run per launch; sandbox helpers moved verbatim to `apps/cli/tests/launch-sandbox.ts` and shared with `content-launch.e2e.test.ts`. |
| R5 | `apps/cli/src/commands/itc.ts:52`, `apps/cli/src/commands/daily.ts:686` — `{ hidden: true }`; inventory and behaviour pinned at `apps/cli/tests/main.test.ts:54`. |
| R7 | `docs/04_DESIGN.md:390` (Board workflow names), `docs/04_DESIGN.md:1506` (hidden routes), `docs/04_DESIGN.md:1509` (scheduler lines). |
| R8 | `apps/board/src/contracts.ts:11` (`WorkflowName`), `apps/cli/src/board/manifest.ts:30` (`workflowFamily`; successors share `FAMILY_SETTINGS` and the artefact manifest), family branches at `apps/cli/src/board/reader.ts:468`, `apps/cli/src/board/daily-voice.ts:683`, `apps/cli/src/commands/board.ts:103`; triage: `plugins/kk/scripts/daily-triage-core.ts:80` (`newsFlowDirs` — configured workflow, then the legacy dir). `audio-quality.ts` holds no works-dir literal, so it is unchanged. |

Deviation from the original three-commit design: the deletion commit is 0372's; this task lands as schedule lines + e2e, then hidden nouns + Board/triage names + docs.

Repointed, not deleted: `scripts/tests/daily-ai-news.test.ts` pinned the old job lines; its assertion now states the scheduler no longer delegates to the operator script and names the `kk news` lines. `docs/04_DESIGN.md` also records that `kk-daily-publish3.yaml` was the scheduled path until this cut-over.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `.spur/config.yaml:151`, `.spur/config.yaml:176`, `.spur/config.yaml:188` — the three `command` values equal design §7 (`docs/design/content-pipeline-consolidation.md:536`); equality asserted at `apps/cli/tests/schedule-no-scripts.e2e.test.ts:39`; `git diff .spur/config.yaml` shows only those three lines |
| R2 | MET | `apps/cli/tests/schedule-no-scripts.e2e.test.ts:35` — each job command runs under the stub-`spur` recorder: exit 0, no `scripts/` path (`apps/cli/tests/schedule-no-scripts.e2e.test.ts:53`), no `bun` spawn (`apps/cli/tests/schedule-no-scripts.e2e.test.ts:54`), one workflow run per launch (`apps/cli/tests/schedule-no-scripts.e2e.test.ts:55-57`) |
| R5 | MET | `apps/cli/src/commands/itc.ts:52`, `apps/cli/src/commands/daily.ts:686` — `{ hidden: true }`; `apps/cli/tests/main.test.ts:54` asserts help omits both and both still answer; installed binary: `kk --help` lists neither, `kk itc candidates --help` exits 0 |
| R7 | MET | `docs/04_DESIGN.md:390` Board workflow names, `docs/04_DESIGN.md:1506` hidden compatible routes, `docs/04_DESIGN.md:1509` scheduler lines, `docs/04_DESIGN.md:1415` shipped heading |
| R8 | MET | `apps/cli/src/board/manifest.ts:30` `workflowFamily`, `apps/board/src/contracts.ts:11` `WorkflowName`, family branches `apps/cli/src/board/reader.ts:468`, `apps/cli/src/board/daily-voice.ts:683`, `apps/cli/src/commands/board.ts:103`; triage `plugins/kk/scripts/daily-triage-core.ts:80` `newsFlowDirs`; tests `apps/cli/tests/board/manifest.test.ts:32`, `plugins/kk/tests/daily-triage.test.ts:279` |
| R9 | MET | `bun run gate` → exit 0 on 2026-11-14 (format, build, lint+typecheck, 58 rules, 5341 pass / 0 fail across 303 files, per-file coverage ≥ 90%); `spur feature check G61 --json` → `pass: true`, no findings |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The scheduler runs without padding scripts (req: R1, R2) | MET | test | `apps/cli/tests/schedule-no-scripts.e2e.test.ts:35` — 1 pass; writes `.works/tmp/test-schedule/summary.json` (three jobs, code 0) |
| AC3 — Old spellings still answer, hidden (req: R5, R7) | MET | test | `apps/cli/tests/main.test.ts:54`; doc `docs/04_DESIGN.md:1506` |
| AC5 — Board and triage find the new run directories (req: R8) | MET | test | `apps/cli/tests/board/manifest.test.ts:32` (successor names share manifest and settings), `plugins/kk/tests/daily-triage.test.ts:279` (kk-news-generate dir, legacy dir, configured name) |
| AC4 — Gate (req: R9) | MET | command | `bun run gate` → exit 0 on 2026-11-14 (format, build, lint+typecheck, 58 rules, 5341 pass / 0 fail across 303 files, per-file coverage ≥ 90%) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Design: `docs/design/content-pipeline-consolidation.md` §1.4, §6, §7, open points 3 and 4. Decision: ADR-053 §2, §7; ADR-037.
- Depends on: 0366, 0367, 0368 (and transitively 0360–0365).
- Parent feature: G61, scenario "The scheduler runs without padding scripts".

### History

- 2026-11-14T21:53:49.456Z backlog → todo (system)
- 2026-11-14T21:53:49.613Z todo → blocked (system)
- 2026-11-15T02:55:05.713Z blocked → wip (system)
- 2026-11-15T04:01:23.680Z wip → testing (system)
- 2026-11-15T04:01:31.871Z testing → done (system)

### Notes

2026-11-14 — unblocked by operator decision: split. R1, R2, R5, R7, R8, R9 land here (operator approved the `.spur/config.yaml` command edits and the installed-package sync). Production-day evidence on the Mac mini, the deletions, the reference sweep and post-deletion doc/template cleanup are task 0372. The old launchers and workflows stay in the tree until then; rollback of this task is reverting the three command lines.

