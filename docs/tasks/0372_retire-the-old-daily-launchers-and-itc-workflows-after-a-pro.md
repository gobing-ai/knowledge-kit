---
schema_version: 1
name: Retire the old daily launchers and ITC workflows after a proven production day on the kk news schedule
status: backlog
template: standard
created_at: 2026-11-15T02:54:16.825Z
updated_at: "2026-11-15T02:54:16.884Z"

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
