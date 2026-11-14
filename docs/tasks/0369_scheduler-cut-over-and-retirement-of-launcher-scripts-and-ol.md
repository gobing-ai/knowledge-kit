---
schema_version: 1
name: Scheduler cut-over and retirement of launcher scripts and old workflows
status: blocked
template: feature-impl
created_at: 2026-11-13T18:13:40.688Z
updated_at: "2026-11-14T21:53:49.613Z"
feature_id: G61

ac_altitude: task-local
ac_numbering: task-local
priority: P2
dependencies: ["0366", "0367", "0368"]
---

## 0369. Scheduler cut-over and retirement of launcher scripts and old workflows

### Background

Phase 4 of G61 (ADR-053 §2, §7). Frozen contract: `docs/design/content-pipeline-consolidation.md` §7 (retirement list and the three replacement scheduler lines) and §1.4 (hidden routes). After 0363–0368 the new verbs and workflows exist beside the old ones; the schedule still runs `bun scripts/daily-ai-news.ts …` (`.spur/config.yaml:151,176,188`) → `plugins/kk/scripts/daily-scheduled-run.ts` → voice3/publish3. This task switches the schedule, then deletes what it replaced.

**This task contains operator-gated steps.** Editing `.spur/config.yaml`, syncing a build into the installed package, re-enabling the scheduler, and every deletion require the operator's explicit go-ahead at the point marked in Plan. The scheduler is currently disabled by the operator (`scheduler.enabled: false`) — do not change that key.

Out of scope: `kk-daily-ai-voice.yaml`, `kk-daily-ai-voice2.yaml`, `kk-daily-safety.yaml`, stage bodies in `plugins/kk/scripts/daily-stages.ts` / `itc-stages.ts` / `kk-workflow-stages.ts`.

### Requirements

- [ ] R1. `.spur/config.yaml`: the `command` of jobs `kk-daily-ai-voice`, `kk-daily-publish3`, `kk-daily-publish3-cn-peak` becomes exactly the three lines in design §7. Job names, crons and every other key are unchanged.
- [ ] R2. New `apps/cli/tests/schedule-no-scripts.e2e.test.ts`: for each of the three job commands, run it with a spawn recorder (stub `spur`, dummy publish) and assert no recorded argv contains `scripts/` or `plugins/kk/scripts/` as an entry script — i.e. no `bun <path under scripts>` process — and that each command resolves to exactly one `spur workflow run` per launch.
- [ ] R3. Cut-over evidence before any deletion: one full scheduled day on the new jobs on the production host (the operator's Mac mini; the laptop is the test host and its rehearsal does not count as this evidence) — generate receipt `done` (or `no-content`), both publish windows settled — with the three receipts and `kk news status` output saved under `docs/tasks/evidence/0369/` (no secrets, no cookies, no env dumps).
- [ ] R4. After R3 is accepted by the operator, delete: `scripts/daily-ai-news.ts`, `scripts/publish-article.ts`, `plugins/kk/scripts/daily-scheduled-run.ts`, `plugins/kk/scripts/voice3-publish-window.ts`, `plugins/kk/workflows/kk-daily-ai-voice3.yaml`, `kk-daily-publish3.yaml`, `kk-itc.yaml`, `kk-itc-author.yaml`, `kk-itc-publish-tail.yaml`, and the tests that exist only to test them (list each deleted test file in Solution with the new test that covers the same behaviour; a test with no successor is kept and repointed, not deleted).
- [ ] R5. `kk itc` and `kk daily` become hidden commands (`{ hidden: true }`, ADR-037) that still work; `kk --help` shows `article` and `news` and neither `itc` nor `daily`. `kk stage run` names from design §6 keep working.
- [ ] R6. `rg -n "daily-ai-news\.ts|publish-article\.ts|daily-scheduled-run|voice3-publish-window|kk-daily-publish3\.yaml|kk-itc-publish-tail|kk-daily-ai-voice3\.yaml" --glob '!docs/tasks/**' --glob '!docs/00_ADR.md' --glob '!.spur/context/**' .` prints only lines inside `docs/design/content-pipeline-consolidation.md` and dated history notes.
- [ ] R7. Docs: `docs/04_DESIGN.md` §1.14 loses "Planned" (it is the shipped surface; old `daily`/`itc` entries are marked hidden-compat); `AGENTS.md` "Editing `plugins/kk/scripts/`" example and `docs/design/kk-daily-ai-voice3.md` point at the new verbs; `docs/05_FEATURES.md` G61 status via `spur feature`. `package.json` scripts referencing deleted files are removed.
- [ ] R8. Board and run-directory names: `apps/cli/src/board/manifest.ts` `WORKFLOW_NAMES` gains `kk-news-generate` and `kk-article-generate`, each reusing the existing artefact manifest of `kk-daily-ai-voice2` / `kk-itc` (old names stay so historical runs still render); `board/reader.ts`, `board/daily-voice.ts`, `daily-triage*.ts` and `audio-quality.ts` resolve the run directory from `content_types.news.workflow` instead of the literal `kk-daily-ai-voice2`. No Board feature work beyond the name mapping.
- [ ] R9. `spur feature check G61` passes with no warning; `bun run gate` exits 0.

### Acceptance Criteria

```gherkin
Scenario: AC1 — The scheduler runs without padding scripts (req: R1, R2, R3)
  Given the scheduler entries for generate and both publish windows
  When a scheduled run executes
  Then no process under `scripts/` or `plugins/kk/scripts/` appears in its process tree
  And schedule-no-scripts.e2e.test.ts passes for all three job commands and writes .works/tmp/test-schedule/summary.json
  And docs/tasks/evidence/0369/ holds one day's generate receipt and two settled publish outcomes from the live schedule on the Mac mini

Scenario: AC2 — The retired paths are gone and nothing points at them (req: R4, R6, R7)
  Given the deletions are applied
  When the R6 rg command and `ls` on each retired path run
  Then every retired path is absent and rg prints only the allowed lines

Scenario: AC3 — Old spellings still answer, hidden (req: R5)
  Given the change is applied
  When `kk --help`, `kk itc candidates --help` and `kk daily prepare --help` run
  Then help lists article and news, omits itc and daily, and the two hidden commands exit 0

Scenario: AC5 — Board and triage find the new run directories (req: R8)
  Given a run under <works>/kk-news-generate/<date> and an old run under <works>/kk-daily-ai-voice2/<date>
  When the Board reader lists runs and `kk daily triage` resolves today
  Then both runs are listed with the same artefact manifest and triage reads the kk-news-generate directory

Scenario: AC4 — Gate (req: R9)
  Given the change is applied
  When `bun run gate` and `spur feature check G61` run
  Then both exit 0 with no warning
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

1. Write `schedule-no-scripts.e2e.test.ts`; confirm it fails against today's commands.
2. Build; **ask the operator** to approve syncing the build and workflows into the installed package (`AGENTS.md` → "Editing `apps/cli`") and editing `.spur/config.yaml`.
3. Apply R1 and R8. Commit 1. Rehearse on the laptop: run the three job commands by hand with dummy publish, then one real generate.
4. **Operator** installs the build on the Mac mini (pin `works_dir` in its config — ADR-042), puts any `content_types.news.channels` switches in its `~/.config/kk/config.yaml`, and enables the schedule there. Wait one full day; collect R3 evidence from that host.
5. **Ask the operator** to approve the deletions. Apply R4. Commit 2.
6. R5–R7. Commit 3.
7. `bun run gate`; `spur feature check G61`; paste outputs into Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Design: `docs/design/content-pipeline-consolidation.md` §1.4, §6, §7, open points 3 and 4. Decision: ADR-053 §2, §7; ADR-037.
- Depends on: 0366, 0367, 0368 (and transitively 0360–0365).
- Parent feature: G61, scenario "The scheduler runs without padding scripts".

### History

- 2026-11-14T21:53:49.456Z backlog → todo (system)
- 2026-11-14T21:53:49.613Z todo → blocked (system)

### Notes

Blocked on operator-gated steps (batch `dev-runall-g61-9beb`, 2026-11-14). Nothing destructive was done.

| Req | State | Why it cannot land unattended |
| --- | --- | --- |
| R1 — three scheduler `command` lines in `.spur/config.yaml` | NOT APPLIED | the task's own Plan step 2 requires operator approval to edit `.spur/config.yaml` and to sync the built CLI into the installed package (`AGENTS.md` → "Editing `apps/cli`"); until that sync happens the scheduled job would run a stale bundle |
| R2 — `apps/cli/tests/schedule-no-scripts.e2e.test.ts` | NOT WRITTEN | its assertions target the post-R1 commands; adding it before R1 lands would leave the gate red |
| R3 — one full scheduled day on the production host (Mac mini) | OWED | it is production evidence; the laptop rehearsal explicitly does not count |
| R4 — delete 5 scripts + 5 workflows and their orphan tests | NOT APPLIED | destructive, and gated on operator acceptance of R3 |
| R5 — `kk itc` / `kk daily` hidden nouns | READY | safe to land independently, but shipping it alone leaves the advertised surface ahead of the cut-over |
| R6/R7 — the `rg` sweep, docs, `package.json` script removals | DEPENDENT | they describe the retired paths; before R4 they would be wrong |
| R8 — Board `WORKFLOW_NAMES` + run-dir resolution | READY | same argument as R5: safe alone, but only meaningful with the cut-over |
| R9 — `gate` + `spur feature check G61` | NOT MET | depends on the above |

**What the operator needs to do, in order**

1. Approve editing `.spur/config.yaml` (three job `command` values from design §7) and syncing the built
   `apps/cli/dist/index.js` + `plugins/kk/workflows/` into the installed package that the scheduler runs.
2. Land R1 + R2 + R5 + R8 (one commit each is fine; R5/R8 are independent).
3. Let one full scheduled day run on the Mac mini and save the three receipts + `kk news status` under
   `docs/tasks/evidence/0369/`.
4. Accept that evidence, then authorize R4's deletions and finish R6/R7.

Everything rows 0365–0368 shipped is already in place and green on this branch, so the cut-over above is
the only thing standing between the scheduler and the new verbs.

