---
schema_version: 1
name: "Close the kk-daily-ai-voice residuals: near-duplicate story clustering and the duplicate kk-collect schedule"
status: backlog
template: standard
created_at: 2026-10-18T19:19:21.893Z
updated_at: "2026-10-18T20:59:33.152Z"

---

## 0316. Close the kk-daily-ai-voice residuals: near-duplicate story clustering and the duplicate kk-collect schedule

> Renumbered from 0318 on 2026-10-18: the earlier `0316` (residuals from 0310) and `0317`
> (residuals from 0311) stubs were cancelled and dropped rather than deferred.

### Background

Residual defects found while diagnosing the 2026-10-18 `kk-daily-ai-voice` no-content
day (commit 08881724 fixed the two that caused it: the `ai-news` extract profile
front-ran `backfillToFloor`, and `kk-collect` ran at 04:35 — after the 04:30 daily run).

## 1. Near-duplicate stories are not clustered, so a published story re-enters the pool

`6d6f8ad075` ("Anthropic 分享 Claude Code 团队的代码审查实践", hackernews, first seen
2026-10-17) and `3bc592cc5b` ("Anthropic Claude Code 团队公开反思代码评审实践") are the
same story — same `first_seen_at`, same event. Story clustering gave each its own
`story_id`, so the topic-scoped exclusion in `kk store extract` cannot see that
`3bc592cc5b` was published on 2026-10-17 05:39 and `6d6f8ad075` stays eligible. Only the
24h window kept it out of today's episode; any widened window (`--window 48h`) re-admits
it, and `dedupPlanByTitle` misses it because the titles differ.

Fix direction: cluster `items.story_id` on a title/URL similarity pass over the same
ingest run (`kk store backfill-facts`, `packages/kk-store/src/story.ts`), or key the
selection exclusion on canonical URL host+slug as a second matcher.

## 2. Two schedulers own `kk-collect`; the launchd one silently skipped today

`~/Library/LaunchAgents/ai.gobing.kk-collect.plist` (04:00/10:00/16:00/22:00) and the
spur scheduler job in `.spur/config.yaml` (now 04:05/10:05/16:05/22:05) both run
`kk-collect.yaml`. At 04:00 today launchd logged `service inactive: ai.gobing.kk-collect`
and started nothing, which is how the 04:30 daily run ended up reading a 6.5h-stale
store. Both serialize on `kk store lock`, so the duplicate costs only a wasted skip in
the normal case — but ownership is ambiguous and either one failing is invisible.

Fix direction: keep the spur scheduler as the single owner (task 0750: "periodic
executions live here and nowhere else") and remove the launchd plist, or drop the spur
job and keep the plist. Operator decision on the host file.

## Evidence

- `.works/kk-daily-ai-voice2/20261018/run-report.summary.txt` (no-content, floor refusal)
- `.works/kk-daily-ai-voice2/20261018/21-plan/20261018_04_quality-control-content_floor-refusal.json`
- `.works/kk-collect/` run dirs: 0500Z / 0537Z / 1135Z / 1700Z / 1736Z, no 1100Z
- `log show --predicate 'process == "launchd" AND eventMessage CONTAINS "kk-collect"'`
- `.works/kk.db` `selections` row for `3bc592cc5b` (published 2026-10-17)

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Two independent seams, both in the store path, no workflow YAML change expected.

**1. Near-duplicate stories.** `items.story_id` is written by `backfillFacts`
(`packages/kk-store/src/story.ts`), which clusters on title similarity inside a collect
window. Two sources covering one event can land on both sides of the threshold, so each
gets its own `story_id` and the topic-scoped exclusion in
`packages/kk-store/src/dao/items.ts` (`excludeTopic`) — a join on `selections.story_id` —
cannot see that the twin was already published. Preferred direction: cluster on
canonical URL identity first (`canonical_url` host + path slug) before the fuzzy title
pass, so the same event from two feeds shares a `story_id` by construction. Fallback:
OR the exclusion with a canonical-URL match against `selections` rather than broadening
the similarity threshold, which re-clusters history.

**2. Duplicate `kk-collect` schedules.** `~/Library/LaunchAgents/ai.gobing.kk-collect.plist`
(installed by hand, 04:00/10:00/16:00/22:00) and the spur scheduler job in
`.spur/config.yaml` (04:05/10:05/16:05/22:05) both run `plugins/kk/workflows/kk-collect.yaml`.
Single-flight is already correct (`kk store lock`), so the cost is a skipped run plus an
invisible failure — today's launchd tick logged `service inactive` and collected nothing.
Project rule (task 0750) makes the spur scheduler the owner of periodic execution, so the
resolution is a host action: `launchctl bootout gui/$(id -u)/ai.gobing.kk-collect` and delete
the plist, leaving `kk schedule render kk-collect` as the documented re-install path. If the
operator prefers launchd, drop the spur job instead — but not both halves of the pair.

## Evidence to reproduce

`sh .spur/rules/... ` is not needed; both defects are reproducible from the store:
`sqlite3 .works/kk.db "select story_id, count(*) from items where first_seen_at = 1792192521382 group by 1"`
shows the twins, and `log show --predicate 'process == "launchd" AND eventMessage CONTAINS "kk-collect"' --last 48h`
shows the skipped ticks.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
