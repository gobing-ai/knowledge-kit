---
schema_version: 1
name: Retire the old daily launchers and ITC workflows after a proven production day on the kk news schedule
status: done
template: standard
created_at: 2026-11-15T02:54:16.825Z
updated_at: "2026-11-15T07:20:30.288Z"

ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close
---

## 0372. Retire the old daily launchers and ITC workflows after a proven production day on the kk news schedule

### Background

Retire the superseded launchers/workflows while preserving successor behavior. Operator update 2026-11-14: production migration and its scheduled-day proof are deferred to standalone task 0373; retain the already-landed retirement with an explicit sequencing exception; off vetoes live-channel flags. Task 0372 readiness covers the code, retirement and documented handoff. Production readiness remains unverified until 0373 passes. This task remains outside G61 by the existing operator scope decision.

### Requirements

- [x] R1. Per operator rescope (2026-11-14), defer the production Mac mini rollout and full scheduled-day validation to task 0373. Update docs/migration.md with a concrete coding-agent handoff covering target discovery, package/build synchronization, persistent works_dir, one scheduler host, xhs remaining off, the three news job lines, approval boundaries, genuine receipt/status evidence under docs/tasks/evidence/0369, and rollback. Current task readiness certifies this handoff, not production cut-over.
- [x] R2. The operator explicitly approved retaining the already-landed retirement on 2026-11-14 with a documented sequencing exception: production validation follows in task 0373. Record that approval and retain the deletions in commit 86ec3def: `scripts/daily-ai-news.ts`, `scripts/publish-article.ts`, `plugins/kk/scripts/daily-scheduled-run.ts`, `plugins/kk/scripts/voice3-publish-window.ts`, `plugins/kk/workflows/kk-daily-ai-voice3.yaml`, `kk-daily-publish3.yaml`, `kk-itc.yaml`, `kk-itc-author.yaml`, `kk-itc-publish-tail.yaml`, and the tests that exist only to test them (list each deleted test with the new test covering the same behaviour; a test with no successor is kept and repointed). One commit, separate from everything else, so rollback is a single `git revert`.
- [x] R3. `rg -n "daily-ai-news\.ts|publish-article\.ts|daily-scheduled-run|voice3-publish-window|kk-daily-publish3\.yaml|kk-itc-publish-tail|kk-daily-ai-voice3\.yaml" --glob '!docs/tasks/**' --glob '!docs/00_ADR.md' --glob '!.spur/context/**' .` prints only lines inside `docs/design/content-pipeline-consolidation.md` and dated history notes (moved from 0369 R6).
- [x] R4. Post-deletion doc and template cleanup: the `kk schedule` cron templates (`kk-daily-ai-voice3.cron.tmpl`, `kk-daily-publish3-*.cron.tmpl`) and their rows in `docs/04_DESIGN.md` §1.13 render the `kk news` verbs; `docs/04_DESIGN.md` daily-supervision and `publish:article` passages, `AGENTS.md` "Editing `plugins/kk/scripts/`" example, `docs/design/kk-daily-ai-voice3.md` and the stale comments above the three jobs in `.spur/config.yaml` point at the new verbs; `package.json` scripts referencing deleted files are removed.
- [x] R5. Operator decision (2026-11-14): off always wins over --live-channels. Resolve the existing specific/plugin config precedence over the preset default first; an effective off row stays excluded even when named by a plugin-wide or variant-specific live token. Preserve config/preset modeSource and the mode off (config) reason. Enabled rows may still be promoted, and invalid or wrong-window tokens still fail. Update design/help wording and prove the behavior through the article/news publish-plan CLI and regression checks.
- [x] R6. `bun run gate` exits 0.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Deferred production migration has an actionable handoff (req: R1)
  Given the operator deferred production migration and scheduled-day validation
  When the current runbook and follow-up task 0373 are inspected
  Then target discovery, installation and approval boundaries, all three jobs, persistent storage, disabled xhs, real evidence and rollback are documented without claiming production readiness

Scenario: AC2 — Retirement is explicitly approved and independently reversible (req: R2)
  Given the operator approved retaining the retirement with a documented sequencing exception
  When the nine listed legacy artifact deletions and successor test mapping are inspected
  Then the retirement is one separate commit and every deleted test has a recorded successor or is retained and repointed

Scenario: AC3 — Legacy reference sweep has only permitted matches (req: R3)
  Given the retired artifacts
  When the exact R3 ripgrep command runs
  Then every match belongs to the consolidation design or dated history notes

Scenario: AC4 — Current schedules and documentation use the news verbs (req: R4)
  Given the retired launchers and workflows
  When the cron templates, package scripts and named documentation passages are inspected
  Then scheduled entries invoke kk news and no package script references a deleted entry

Scenario: AC5 — Off vetoes explicit live-channel promotion (req: R5)
  Given an effective off channel and a plugin-wide or variant-specific live-channel token
  When article or news publish-plan applies the channel switchboard
  Then the channel stays excluded with its config mode source and no live payload row is planned

Scenario: AC6 — Repository quality gate passes (req: R6)
  Given the final retirement tree
  When bun run gate runs
  Then it exits zero without bypassing any check
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-15T06:58:09.879Z

Operator decisions, 2026-11-14: (1) defer production migration and scheduled-day proof, with a coding-agent handoff; (2) approve retaining the landed retirement with a documented sequencing exception; (3) off always wins. The operator numbered the last item R3 in the message; it resolves this task's R5 channel-precedence decision. The R3 reference sweep is unchanged. Follow-up task: 0373; runbook: docs/migration.md.

### Design

Use the existing shared applyChannelModes helper: resolve variant/plugin config over preset defaults and allow live promotion only when the effective mode is not off. Validate channel tokens against all rows in the selected window, including disabled rows; selection still excludes off rows. Preserve source attribution, unknown/wrong-window refusal and enabled-row promotion. Update owning ADR/design/help projections together. Reuse docs/migration.md and create standalone deferred task 0373; perform no production installation, schedule changes or sends. Retain the existing retirement commit rather than rewriting history.

### Plan

1. [x] Record the operator rescope, sequencing exception and off-veto decision.
2. [x] Create deferred task 0373 and update docs/migration.md for the production coding agent.
3. [x] Reproduce live-channel promotion of disabled rows with regression-first CLI checks.
4. [x] Fix the shared helper/window token validation and synchronize design/help documentation.
5. [x] Pass the final repository quality gate and review the final diff.
6. [ ] Record the canonical PASS verdict and close task 0372 without claiming production readiness.

### Solution

The retirement commits are on main and are retained with Robin's explicit sequencing exception (2026-11-14). Production migration and its real scheduled-day proof are deferred to standalone task 0373. The current task certifies the retirement, off-veto behavior and actionable handoff, not production cut-over readiness. It remains outside G61 by the operator scope decision.

**R2 — the retirement (commit `86ec3def`, one commit, single `git revert`).**

| Deleted | Successor |
| --- | --- |
| `scripts/daily-ai-news.ts` | `kk news generate` / `kk news publish` (`apps/cli/src/commands/content-generate.ts`, `content-launch.ts`) |
| `scripts/publish-article.ts` | `kk article generate` + `plugins/kk/workflows/kk-publish.yaml` |
| `plugins/kk/scripts/daily-scheduled-run.ts` | `apps/cli/src/launch.ts` (the `kk news` launcher) |
| `plugins/kk/scripts/voice3-publish-window.ts` | `apps/cli/src/commands/content-launch.ts` |
| `plugins/kk/workflows/kk-daily-ai-voice3.yaml` | `plugins/kk/workflows/kk-news-generate.yaml` |
| `plugins/kk/workflows/kk-daily-publish3.yaml` | `plugins/kk/workflows/kk-publish.yaml` |
| `plugins/kk/workflows/kk-itc.yaml` | `plugins/kk/workflows/kk-article-generate.yaml` |
| `plugins/kk/workflows/kk-itc-author.yaml` | `plugins/kk/workflows/kk-article-generate.yaml` |
| `plugins/kk/workflows/kk-itc-publish-tail.yaml` | `plugins/kk/workflows/kk-publish.yaml` |

Nine test files were deleted with them, each with a successor that asserts the same behaviour:
`scripts/tests/daily-ai-news.test.ts` → `kk-news-generate.e2e` + `kk-publish.e2e`;
`plugins/kk/tests/daily-scheduled-run.test.ts` → `launch-safety-dag` + `launch.test`;
`apps/cli/tests/kk-itc-dag.test.ts`, `kk-itc-workflow.test.ts` → `kk-article-generate-fsm`;
`kk-itc-publish-tail.test.ts`, `kk-daily-publish3.test.ts` → `kk-publish.e2e`;
`voice3-dag.test.ts` → `kk-news-generate-dag`; `voice3-migration-0334.test.ts` → `commands/schedule.test`;
`voice3-migration.e2e.test.ts` → `kk-news-generate.e2e`.

Eleven surviving tests were repointed rather than weakened: `launch-safety-dag` (IN_SCOPE →
the surviving four workflows; the nested-invocation scan now ignores a description that merely
quotes the invocation form), `safety-variants-scope` (variants/safety-variants/freeze node ids),
`publish-matrix-0332` (F13 now pins one `--run-date` normalization in `kk-publish.yaml`),
`publish-matrix-0333` (the publish3 outcome cases moved to `kk-publish.e2e`; a new F11 covers the
failing `store mark-published` branch that the deleted cases used to reach),
`kk-publish.e2e` (AC3 compares three windows of `kk-publish.yaml` instead of publish3-vs-publish),
`verdict-confidence` (the retired ITC-author FSM block dropped — `itc-publish.test.ts` already tests
`itcAuthorVerdict` dispositions directly; the parser-gap check now compares extracted shell guards
against the workflows' own guard kinds), `daily-script-retry-regression`,
`safety-variants-scope`, `daily-triage`, `board-package`, `commands/content-launch`.

**R3 — the sweep (commit `e3f768ba`).** The command in R3 now prints only
`docs/design/content-pipeline-consolidation.md` (20 lines) plus dated history notes (`CHANGELOG.md`,
`docs/report/2026-11-0*`, `docs/dogfood/INDEX.md`). Source comments and workflow descriptions name the
retired artifact without the path; the three retired-DAG sections in `docs/04_DESIGN.md` carry a
retirement banner instead of being rewritten.

**R4 — docs and templates (commit `b47ace5a`).** The three cron templates keep their schedule ids and
now render `kk news generate --publish` / `kk news publish --window <w> --unattended` (the generation
tick's log dir moves to `.works/kk-news-generate`; the publish logs to `.works/kk-news-publish`). The
`daily-news:*` and `publish:article` package scripts are gone. `docs/04_DESIGN.md` §1.13 rows,
the daily-supervision passage and the `publish:article` passage describe the current entries; the
`.spur/config.yaml` job comments, `docs/design/kk-daily-ai-voice3.md`, `docs/03_ARCHITECTURE.md`, the
G2/G15/G61/L2 feature docs and `AGENTS.md` no longer point at deleted files.

**R5 — off always wins (operator decision 2026-11-14).** `apps/cli/src/publish-matrix.ts:339` now guards promotion with the effective config/preset mode. Disabled rows retain their config/preset mode source and stay excluded even when named by --live-channels. Window token validation recognizes disabled rows as legitimate selections without promoting them. `apps/cli/tests/content-publish.e2e.test.ts:39` covers plugin/variant tokens, config/preset off and both article/news CLI plans, including the existing dummy exclusion path. Help in both launch and publish-plan verbs names the off veto.

**R1 — production deliberately deferred.** Task 0373 owns the production migration and genuine scheduled-day receipts. `docs/migration.md:3` is the current coding-agent handoff: re-confirm the historical target ssh homelab, inspect the installed build, require approval for concrete production mutations, pin persistent works_dir, preserve kk.db, keep one scheduler host and xhs off, run the three news jobs, save redacted receipts/status and preserve rollback. No production changes or sends were performed.

Verification repair (2026-11-14): added six task-local acceptance scenarios directly from R1-R6 and corrected the merged-state summary. Corrected the cron/template and Design schedule descriptions: generation with --publish starts after-generate publishing, live-confirm is opt-in, and overseas preset rows are dummy/off. The voice3 design rehearsal now uses the supported news generate --dry-run flag instead of --dummy. Those earlier documentation repairs did not change runtime behavior; the later operator-approved off-veto change is described under R5 above. Production configuration remains untouched.


Final verification: bun run gate exits 0 with 5171 pass, 0 fail, 26211 assertions across 294 files; coverage accepted; all 58 pre-check and 2 post-check rules pass. Focused regression-first proof and migration-handoff checks are saved under .spur/run/0372-*. Task 0373 remains deferred and unstarted (the harness advanced it to todo). Production execution is not claimed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/migration.md:3` is the current production coding-agent handoff. Task 0373 captures the deferred work. Repeatable handoff checks confirm target, approvals, storage, one scheduler, xhs off, all jobs, real receipts/status and rollback; 0373 remains unstarted (todo). Receipt: knowledge-kit verification run `.spur/run/0372-handoff-check.log` line 1. |
| R2 | MET | Robin explicitly approved retaining retirement with a sequencing exception, recorded in task Q&A and ADR-053. git show 86ec3def confirms one separate deletion commit and nine test-successor mappings; `docs/tasks/0372_retire-the-old-daily-launchers-and-itc-workflows-after-a-pro.md:89` preserves them. Static checks confirm all nine artifacts are absent. No approval-before-deletion claim is made. |
| R3 | MET | Exact R3 sweep plus allowlist assertions finds only 41 permitted matches in the consolidation design and dated history. Receipt: knowledge-kit verification run `.spur/run/0372-static-check.log` line 1. |
| R4 | MET | Three cron render commands and package-script checks pass; `plugins/kk/schedules/kk-daily-ai-voice3.cron.tmpl:17`, `plugins/kk/schedules/kk-daily-publish3-overseas.cron.tmpl:24`, `plugins/kk/schedules/kk-daily-publish3-cn-peak.cron.tmpl:24`, `docs/04_DESIGN.md:1088`, `docs/04_DESIGN.md:1181`. Schedule descriptions now match after-generate publishing and opt-in live confirmation; the rehearsal uses the supported dry-run flag. |
| R5 | MET | `apps/cli/src/publish-matrix.ts:338` guards promotion with effective config/preset mode. Window validation recognizes disabled tokens without selecting their targets. `apps/cli/tests/content-publish.e2e.test.ts:39` covers plugin/variant tokens and config/preset off; its CLI flow drives both article/news with dummy/live flags, keeping rows empty and mode off (config). Regression-first run reproduced 3 failures; focused final run has 9 pass, 0 fail, 65 assertions; related suites have 61 pass, 0 fail. ADR/design/help match the operator decision. |
| R6 | MET | bun run gate exits 0: format, build, lint/typecheck, all 58 pre-check rules, 5171 tests across 294 files (0 failures, 26211 assertions), coverage thresholds accepted, all 2 post-check rules. Receipt: knowledge-kit verification run `.spur/run/0372-final-gate.log` line 1. Fix-pass artifact disclosure: .spur/run/0372-ac.md:1-31; .spur/run/0372-background.md:1-1; .spur/run/0372-requirements.md:1-6; .spur/run/0372-design.md:1-1; .spur/run/0372-plan.md:1-6; .spur/run/0372-qa.md:1-1; .spur/run/0372-solution.md:1-59; .spur/run/0372-references.md:1-3; .spur/run/0372-followup.json:1-15; .spur/run/0372-fix-created.json:1-8; .spur/run/0372-static-check.ts:1-38; .spur/run/0372-static-check.log:1-1; .spur/run/0372-generation.cron:1-17; .spur/run/0372-overseas.cron:1-24; .spur/run/0372-cn-peak.cron:1-24; .spur/run/0372-handoff-check.ts:1-24; .spur/run/0372-handoff-check.log:1-1; .spur/run/0372-off-red.log:1-193; .spur/run/0372-off-green.log:1-126; .spur/run/0372-related-tests.log:1-183; .spur/run/0372-typecheck.log:1-1; .spur/run/0372-final-format.log:1-2; .spur/run/0372-final-gate.log:1-345; .spur/run/0373-ac.md:1-21; .spur/run/0373-background.md:1-1; .spur/run/0373-design.md:1-1; .spur/run/0372-final-verify-answer.txt:1-45; .spur/run/0372-verify-answer.txt:1-45; .spur/run/0372-verdict.json:1-122 (created or replaced during this verification). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Deferred production migration has an actionable handoff | MET | command | `docs/migration.md:3` and task 0373 pass the handoff checks; knowledge-kit verification run `.spur/run/0372-handoff-check.log` line 1. |
| AC2 — Retirement is explicitly approved and independently reversible | MET | command | Explicit operator sequencing exception is in task Q&A and ADR-053; git show 86ec3def proves the separate deletion commit and successor mappings; `docs/tasks/0372_retire-the-old-daily-launchers-and-itc-workflows-after-a-pro.md:89`. |
| AC3 — Legacy reference sweep has only permitted matches | MET | command | Exact sweep and allowlist pass: knowledge-kit verification run `.spur/run/0372-static-check.log` line 1. |
| AC4 — Current schedules and documentation use the news verbs | MET | command | Rendered cron and package-script checks pass; `docs/04_DESIGN.md:1181`, `plugins/kk/schedules/kk-daily-ai-voice3.cron.tmpl:17`; knowledge-kit verification run `.spur/run/0372-static-check.log` line 1. |
| AC5 — Off vetoes explicit live-channel promotion | MET | test | `apps/cli/tests/content-publish.e2e.test.ts:39` and its article/news CLI flow pass: disabled rows stay excluded with mode off (config). Focused receipt: knowledge-kit verification run `.spur/run/0372-off-green.log` line 1; 9 pass, 0 fail, 65 assertions. |
| AC6 — Repository quality gate passes | MET | command | bun run gate exits 0: format, build, lint/typecheck, all 58 pre-check rules, 5171 tests across 294 files (0 failures, 26211 assertions), coverage thresholds accepted, all 2 post-check rules. Receipt: knowledge-kit verification run `.spur/run/0372-final-gate.log` line 1. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Current production coding-agent handoff: `docs/migration.md:3`.
- Deferred work: task 0373, `docs/tasks/0373_migrate-the-kk-news-schedule-to-the-production-mac-mini-and-.md:15`.
- Operator scope/precedence amendment: ADR-053 in `docs/00_ADR.md`.

### History

- 2026-11-15T06:06:51.729Z backlog → wip (system)

- 2026-11-15 — landed on `main`: the six retirement commits (`86ec3def`, `e3f768ba`, `b47ace5a`,
  `7fcb0c13`, `b9d9e6d6`, `1f2360fe`) merged linearly. `main` had advanced to `ea7200c4` (E9 docs)
  after the branch was cut, so `git merge --ff-only` refused; the divergence was resolved by replaying
  that one commit on top of the branch, which rewrote it as `54339f44`. Nothing was pushed, so no
  published history changed. Branch and worktree removed. R1 stays open.
- 2026-11-15T06:38:29.966Z wip → testing (system)
- 2026-11-15T07:20:30.206Z testing → done (system)

