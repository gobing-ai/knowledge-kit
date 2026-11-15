---
schema_version: 1
name: Retire the old daily launchers and ITC workflows after a proven production day on the kk news schedule
status: wip
template: standard
created_at: 2026-11-15T02:54:16.825Z
updated_at: "2026-11-15T06:14:56.878Z"

---

## 0372. Retire the old daily launchers and ITC workflows after a proven production day on the kk news schedule

### Background

Captured from the creation title: "Retire the old daily launchers and ITC workflows after a proven production day on the kk news schedule".

### Requirements

- [ ] R1. Cut-over evidence before any deletion (moved from 0369 R3): one full scheduled day on the new job lines (`kk news generate --publish`, `kk news publish --window overseas-rss --unattended`, `kk news publish --window cn-peak --unattended`) on the production host (the operator's Mac mini; a laptop rehearsal does not count) — generate receipt `done` or `no-content`, both publish windows settled — with the three receipts and `kk news status` output saved under `docs/tasks/evidence/0369/` (no secrets, no cookies, no env dumps). xhs stays off while the account is flagged.
- [ ] R2. After the operator accepts R1 and explicitly approves the deletions (moved from 0369 R4), delete: `scripts/daily-ai-news.ts`, `scripts/publish-article.ts`, `plugins/kk/scripts/daily-scheduled-run.ts`, `plugins/kk/scripts/voice3-publish-window.ts`, `plugins/kk/workflows/kk-daily-ai-voice3.yaml`, `kk-daily-publish3.yaml`, `kk-itc.yaml`, `kk-itc-author.yaml`, `kk-itc-publish-tail.yaml`, and the tests that exist only to test them (list each deleted test with the new test covering the same behaviour; a test with no successor is kept and repointed). One commit, separate from everything else, so rollback is a single `git revert`.
- [ ] R3. `rg -n "daily-ai-news\.ts|publish-article\.ts|daily-scheduled-run|voice3-publish-window|kk-daily-publish3\.yaml|kk-itc-publish-tail|kk-daily-ai-voice3\.yaml" --glob '!docs/tasks/**' --glob '!docs/00_ADR.md' --glob '!.spur/context/**' .` prints only lines inside `docs/design/content-pipeline-consolidation.md` and dated history notes (moved from 0369 R6).
- [ ] R4. Post-deletion doc and template cleanup: the `kk schedule` cron templates (`kk-daily-ai-voice3.cron.tmpl`, `kk-daily-publish3-*.cron.tmpl`) and their rows in `docs/04_DESIGN.md` §1.13 render the `kk news` verbs; `docs/04_DESIGN.md` daily-supervision and `publish:article` passages, `AGENTS.md` "Editing `plugins/kk/scripts/`" example, `docs/design/kk-daily-ai-voice3.md` and the stale comments above the three jobs in `.spur/config.yaml` point at the new verbs; `package.json` scripts referencing deleted files are removed.
- [ ] R5. Decide and record (operator): `--live-channels` currently overrides a config channel mode of `off` (`apps/cli/src/publish-matrix.ts` `applyChannelModes`), which matches the design precedence table but not the wording "from `draft` to `live`" in `docs/design/content-pipeline-consolidation.md`. Either make `off` win or fix the wording; add one test for the chosen behaviour.
- [ ] R6. `bun run gate` exits 0.

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

1. Operator installs the build on the Mac mini (pin `works_dir`, ADR-042), enables the schedule there, waits one full day; collect R1 evidence from that host.
2. Ask the operator to approve the deletions. Apply R2 as one commit.
3. R3 sweep, R4 docs/templates, R5 decision.
4. `bun run gate`.

### Solution

Work landed on branch `sp/run-0372-d27f` (worktree `../knowledge-kit-run-0372-d27f`) in five commits; the tree
stays unmerged because R1 cannot be satisfied from this host.

**R2 — the retirement (commit `86ec3def`, one commit, single `git revert`).**

| Deleted | Successor |
| --- | --- |
| `scripts/daily-ai-news.ts` | `kk news generate` / `kk news publish` (`apps/cli/src/commands/content-generate.ts`, `content-launch.ts`) |
| `scripts/publish-article.ts` | `kk article-generate` + `plugins/kk/workflows/kk-publish.yaml` |
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

**R5 — the `--live-channels` decision (commit `7fcb0c13`).** The shipped precedence stands
(`apps/cli/src/publish-matrix.ts:339`: flag beats config mode), so the wording in
`docs/design/content-pipeline-consolidation.md` §2 now says the flag overrides the config
switchboard, and `apps/cli/tests/content-publish.e2e.test.ts` pins it: a config `off` row named in
`--live-channels` plans `live` with `modeSource: flag`.

**Not done — R1.** No production-day evidence exists: `docs/tasks/evidence/0369/` does not exist,
`.works/` holds no `kk-news-*` run directory, and this host is the laptop (`MBP-2026`, no crontab)
while ADR-053 names the Mac mini as the production schedule host. The operator confirmed R1 is
outstanding, so the run stops here and the branch is retained for review.

### Testing

Worktree `../knowledge-kit-run-0372-d27f` on branch `sp/run-0372-d27f` (base `main` @ `9df2cd24`).

- `bun run lint` — PASS (Biome 2.5.15 `Checked 816 files`, every workspace `typecheck: Exited with code 0`).
- `bun run build` — PASS (all workspaces; `apps/cli/dist/index.js` bundled, 2.22 MB).
- `bun run gate` — **PASS, exit 0**: format + build + lint + `spur rule run --preset
  recommended-pre-check` (2 rules) + `bun run test` → `5171 pass, 0 fail, 26212 expect() calls,
  Ran 5171 tests across 294 files`, followed by `spur rule run --preset recommended-post-check`
  → `All 2 rules passed`.

Coverage: the retirement initially dropped `apps/cli/src/publish-matrix.ts` to 89.77% line coverage,
which fails the per-file 90% threshold and exits the run 1 while printing `0 fail`. Commit
`b9d9e6d6` adds the settlement failure case that restores it; the final gate run is green.

Repro of the R3 sweep (expect only `docs/design/content-pipeline-consolidation.md` and dated
history notes):

```bash
rg -n "daily-ai-news\.ts|publish-article\.ts|daily-scheduled-run|voice3-publish-window|kk-daily-publish3\.yaml|kk-itc-publish-tail|kk-daily-ai-voice3\.yaml" \
  --glob '!docs/tasks/**' --glob '!docs/00_ADR.md' --glob '!.spur/context/**' .
```

Two worktree-only notes: `.spur/run/` and `.spur/memory/` are untracked per-tree planes, so the
`no-dead-run-scoped-citation` rule failed until the cited `0365/0366/0367` receipts and the
`0362-0364` batch artifacts were copied in from the main tree; and `proto trust .prototools` is
required once per fresh worktree before its hooks can commit.

Not verified: no scheduled run has executed the rewritten cron lines (R1 is the missing evidence),
so the `kk news generate --publish` / `kk news publish --window … --unattended` entries are proven by
their own e2e suites and by `kk schedule render`, not by a production tick.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-11-15T06:06:51.729Z backlog → wip (system)

- 2026-11-15 — landed on `main`: the six retirement commits (`86ec3def`, `e3f768ba`, `b47ace5a`,
  `7fcb0c13`, `b9d9e6d6`, `1f2360fe`) merged linearly. `main` had advanced to `ea7200c4` (E9 docs)
  after the branch was cut, so `git merge --ff-only` refused; the divergence was resolved by replaying
  that one commit on top of the branch, which rewrote it as `54339f44`. Nothing was pushed, so no
  published history changed. Branch and worktree removed. R1 stays open.

