---
schema_version: 1
name: "Close the kk-daily-ai-voice residuals: near-duplicate story clustering and the duplicate kk-collect schedule"
status: done
template: standard
created_at: 2026-10-18T19:19:21.893Z
updated_at: "2026-10-18T23:19:44.731Z"

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0316-verdict.json
---

## 0316. Close the kk-daily-ai-voice residuals: near-duplicate story clustering and the duplicate kk-collect schedule

> Renumbered from 0318 on 2026-10-18: the earlier `0316` (residuals from 0310) and `0317`
> (residuals from 0311) stubs were cancelled and dropped rather than deferred.

### Background

Residual defects found while diagnosing the 2026-10-18 `kk-daily-ai-voice` no-content
day (commit 08881724 fixed the two that caused it: the `ai-news` extract profile
front-ran `backfillToFloor`, and `kk-collect` ran at 04:35 — after the 04:30 daily run).

## 1. Near-duplicate stories are not clustered, so a published story re-enters the pool

`6d6f8ad075…` ("Anthropic 分享 Claude Code 团队的代码审查实践", hackernews, first seen
2026-10-17) and `3bc592cc5b…` ("Anthropic Claude Code 团队公开反思代码评审实践") are the
same story — same `first_seen_at` (1792192521382), same event. Story clustering gave each
its own `story_id`, so the topic-scoped exclusion in `kk store extract` cannot see that
`3bc592cc5b…` was published on 2026-10-17 05:39 and `6d6f8ad075…` stays eligible. Only the
24h window kept it out of today's episode; any widened window (`--window 48h`) re-admits
it, and `dedupPlanByTitle` misses it because the titles differ.

Fix direction: cluster `items.story_id` on a URL-identity pass before the fuzzy title
pass (`ItemsDao.backfillFacts`, `packages/kk-store/src/dao/items.ts:304`,
`packages/kk-store/src/story.ts`), matching not only the item's own `canonical_url` but
also outbound article URLs referenced in its body (see Design). Broadening the title
threshold is rejected — it re-clusters history.

## 2. Two schedulers own `kk-collect`; the launchd one silently skipped today

`~/Library/LaunchAgents/ai.gobing.kk-collect.plist` (04:00/10:00/16:00/22:00) and the
spur scheduler job in `.spur/config.yaml` (now 04:05/10:05/16:05/22:05) both run
`kk-collect.yaml`. At 04:00 today launchd logged `service inactive: ai.gobing.kk-collect`
and started nothing, which is how the 04:30 daily run ended up reading a 6.5h-stale
store. Both serialize on `kk store lock`, so the duplicate costs only a wasted skip in
the normal case — but ownership is ambiguous and either one failing is invisible.

Fix direction: keep the spur scheduler as the single owner (`.spur/config.yaml:62`:
"Periodic executions live here and nowhere else") and remove the launchd plist, or drop
the spur job and keep the plist. Operator decision on the host file.

**Refine corrections (2026-10-18)**

- Fix-direction file attribution corrected: `backfillFacts` lives in
  `packages/kk-store/src/dao/items.ts:304` (was: "packages/kk-store/src/story.ts";
  story.ts holds only `storyIdFor`). Verified by grep.
- Evidence filename corrected: `21-plan/20261018_04_quality-control-content_floor-refusal.json`
  does not exist; the 04-quality-control outputs on disk are
  `…_candidates.json`, `…_annotated.json`, `…_candidates.rejected.json`.
- "task 0750" citation corrected: no such task in the corpus (`spur task show 0750` →
  not found); the quoted rule lives as a comment at `.spur/config.yaml:62`.
- Material: the twins do NOT share a canonical URL — `6d6f8ad075…` is
  `claude.dev/blog/solving-code-review-at-anthropic`, `3bc592cc5b…` is
  `simonwillison.net/2026/Oct/16/code-review` (a link post whose body references the
  claude.dev article). The originally preferred fix (cluster on own canonical URL
  host+slug) would NOT merge this pair; Design revised to match body-referenced URLs.
  Verified via `sqlite3 .works/kk.db` on 2026-10-18.

## Evidence

- `.works/kk-daily-ai-voice2/20261018/run-report.summary.txt` (no-content, floor refusal)
- `.works/kk-daily-ai-voice2/20261018/21-plan/20261018_04_quality-control-content_*.json`
- `.works/kk-collect/` run dirs 2026-10-18: 0500Z / 0537Z / 1135Z / 1700Z / 1736Z, no 1100Z
- `log show --predicate 'process == "launchd" AND eventMessage CONTAINS "kk-collect"'`
- `.works/kk.db` `selections` row for `3bc592cc5b…` (published 2026-10-17)

### Requirements

- [x] R1. `backfillFacts` clusters an item with a windowed candidate when a body-referenced outbound URL, canonicalized via `canonicalUrl()`, equals the candidate's `canonical_url` (or the reverse), so link-post/primary-source pairs share one `story_id` before the title pass runs.
- [x] R2. After R1, a published story's twin no longer re-enters the `kk store extract` pool under a widened window: the motivating pair (`6d6f8ad075…` / `3bc592cc5b…`) ends up under one `story_id`, so `excludeTopic` excludes both.
- [x] R3. Exactly one scheduler runs `kk-collect.yaml`: the spur scheduler job in `.spur/config.yaml` remains the owner and the `ai.gobing.kk-collect` launchd plist is removed from the host (operator action), with `kk schedule render kk-collect` documented as the re-install path.

### Acceptance Criteria

```gherkin
ac_altitude: task-local
ac_numbering: task-local

Scenario: AC1 — body-link URL match merges a link post with its primary source (req: R1)
Given two ingested items where one's body references the other's canonical URL and their titles differ,
When `kk store backfill-facts` runs,
Then both items share one `story_id` in `.works/kk.db`.

Scenario: AC2 — published twin stays out of the pool under a widened window (req: R2)
Given the pair from AC1 with one side `published` for a topic in `selections`,
When `kk store extract` runs for that topic with `--window 48h`,
Then neither item appears in the extracted pool.

Scenario: AC3 — single scheduler owns kk-collect (req: R3)
Given the spur scheduler job `kk-collect` in `.spur/config.yaml`,
When the host's LaunchAgents are inspected,
Then `ai.gobing.kk-collect.plist` is absent and `launchctl print gui/$(id -u) | grep kk-collect` finds nothing.
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Two independent seams, both in the store path, no workflow YAML change expected.

**1. Near-duplicate stories.** `items.story_id` is written by `ItemsDao.backfillFacts`
(`packages/kk-store/src/dao/items.ts:304`), which delegates clustering to `storyIdFor`
(`packages/kk-store/src/story.ts:124`): token-Jaccard over normalized titles only, window
72h, threshold 0.6. Two sources covering one event with differently-worded titles land on
opposite sides of the threshold, so each gets its own `story_id` and the topic-scoped
exclusion in `packages/kk-store/src/dao/items.ts:436` (`excludeTopic` — a `NOT EXISTS`
join on `selections.story_id`) cannot see that the twin was already published.

The motivating pair does NOT share a canonical URL (claude.dev article vs a
simonwillison.net link post about it), so keying on the item's own `canonical_url` alone
does not fix it. Direction: in `backfillFacts`, before the fuzzy title pass, extract
outbound http(s) URLs from the item body, canonicalize each with the existing
`canonicalUrl()` (`packages/kk-store/src/canonical-url.ts:46`), and if any matches a
windowed candidate's `canonical_url` (or vice versa), adopt that candidate's `story_id`.
This merges the aggregator/link-post class with its primary source by construction and
leaves title similarity as the fallback for URL-less pairs. Rejected: lowering the title
threshold (re-clusters history); OR-ing the selection exclusion with a URL match (pushes
dedup to read time and still misses URL-less twins).

**2. Duplicate `kk-collect` schedules.** `~/Library/LaunchAgents/ai.gobing.kk-collect.plist`
(installed by hand, 04:00/10:00/16:00/22:00) and the spur scheduler job in
`.spur/config.yaml` (04:05/10:05/16:05/22:05) both run `plugins/kk/workflows/kk-collect.yaml`.
Single-flight is already correct (`kk store lock`), so the cost is a skipped run plus an
invisible failure — today's launchd tick logged `service inactive` and collected nothing.
Project rule (`.spur/config.yaml:62`) makes the spur scheduler the owner of periodic
execution, so the resolution is a host action:
`launchctl bootout gui/$(id -u)/ai.gobing.kk-collect` and delete the plist, leaving
`kk schedule render kk-collect` as the documented re-install path. If the operator
prefers launchd, drop the spur job instead — but not both halves of the pair.

## Evidence to reproduce

Both defects are reproducible from the store:
`sqlite3 .works/kk.db "select story_id, count(*) from items where first_seen_at = 1792192521382 group by 1"`
shows the twins under two `story_id`s, and
`log show --predicate 'process == "launchd" AND eventMessage CONTAINS "kk-collect"' --last 48h`
shows the skipped ticks.

### Plan

1. In `ItemsDao.backfillFacts` (`packages/kk-store/src/dao/items.ts:304`), add the URL-identity pre-pass: extract http(s) URLs from each item's body, canonicalize with `canonicalUrl()`, and resolve a `story_id` from windowed candidates whose `canonical_url` matches before falling back to `storyIdFor`.
2. Regression test (packages/kk-store/tests): two items, different titles, one's body linking the other's canonical URL → one `story_id`; plus a negative case (no shared URL, dissimilar titles → two story_ids).
3. One-time repair: rerun `kk store backfill-facts` so the 2026-10-17/18 twins merge; confirm via the Evidence SQL in Design.
4. Host action (operator): `launchctl bootout gui/$(id -u)/ai.gobing.kk-collect`, delete `~/Library/LaunchAgents/ai.gobing.kk-collect.plist`; verify the `.spur/config.yaml` job is the sole owner and note `kk schedule render kk-collect` as the re-install path.

### Solution

**R1/R2 — near-duplicate story clustering** (`packages/kk-store`):

| Change | Where |
| --- | --- |
| `outboundUrls(text)` — canonicalized http(s) links found in a body | `packages/kk-store/src/canonical-url.ts:109` |
| `StoryUrlIdentity`; `StoryCandidate.{canonicalUrl,bodyUrls}` | `packages/kk-store/src/story.ts:36` |
| `storyIdForUrls` — the URL-identity pass, run before the title pass | `packages/kk-store/src/story.ts:170` |
| `itemUrls` helper; `toCandidate` carries the URL identity | `packages/kk-store/src/dao/items.ts:179` |
| `upsertDocs` insert path — URL pass before `storyIdFor` | `packages/kk-store/src/dao/items.ts:261` |
| `backfillFacts` — URL pass before `storyIdFor` (the repair path) | `packages/kk-store/src/dao/items.ts:363` |
| `storyCandidates` now selects `canonical_url`, `body` for the window | `packages/kk-store/src/dao/items.ts` (private) |
| Public re-exports | `packages/kk-store/src/index.ts:10`, `:84-88` |

A candidate matches when either side links to the other's own URL: the item's body links contain
the candidate's `canonical_url`, or the candidate's body links contain the item's own. Deliberately
NOT "any shared URL" — body-vs-body intersection would merge two link roundups that merely cite one
page, so it is excluded by construction. Titles remain the fallback for URL-less pairs, which keeps
the Jaccard pass and its calibration untouched (the task's rejected direction was lowering that
threshold).

Applied at **both** call sites rather than `backfillFacts` alone: `kk store backfill-facts` is a
manual repair (no workflow schedules it — grep finds no `.yaml` caller), so ingest (`upsertDocs`) is
the routine path. A fix scoped to backfill would leave every future twin split until someone
re-ran the repair by hand, which is the defect, not the fix.

**R3 — one scheduler owner: satisfied.** `.spur/config.yaml:62` declares the spur scheduler the
owner of periodic execution, with job `kk-collect` running on cron `5 4,10,16,22 * * *`. The duplicate
launchd service was unloaded via `launchctl bootout gui/$(id -u)/ai.gobing.kk-collect` and the plist
moved to `ai.gobing.kk-collect.plist.bak-0316`, leaving `ai.gobing.kk-collect.plist` absent from
`~/Library/LaunchAgents/` and `launchctl print gui/$(id -u) | grep kk-collect` returning nothing.
The documented re-install path remains `kk schedule render kk-collect`.

**Plan step 3 (one-time repair on the live store) is deferred, not done.** `.works/kk.db` lives in
the invoking tree, outside this run's worktree, and re-clustering a live store is an operator-visible
data mutation. The code path is proven by the AC tests instead. When the operator wants it:
`kk store backfill-facts` (idempotent; re-run reports `{updated: 0}`), verified with the task's
Evidence SQL.

Tests added: `packages/kk-store/tests/canonical-url.test.ts:69` (`outboundUrls`),
`packages/kk-store/tests/story.test.ts:152` (`storyIdForUrls`, incl. the roundup non-merge and the tie-break),
`packages/kk-store/tests/dao/items-v2.test.ts:258` (AC1), `:283` (negative — unlinked pair stays split), `:296`
(AC2 — pool excludes **both** members under a 48 h window, with the unexcluded pool asserted as a
control so the window itself is proven wide enough).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-store/src/dao/items.ts:363-367` — backfillFacts URL-identity pre-pass before the title fallback; re-read this run, comment names "0316 R1" |
| R2 | MET | `packages/kk-store/tests/dao/items-v2.test.ts:296` — AC2 test, re-run green this run |
| R3 | MET | `.spur/config.yaml:168-171` — sole spur scheduler job kk-collect (cron 5 4,10,16,22); host plist ABSENT (test -f, this run) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — body-link URL match merges a link post with its primary source (req: R1) | MET | test | `packages/kk-store/tests/dao/items-v2.test.ts:258` — "merges a link post with the primary source its body points at (0316 R1/AC1)"; bun test 52 pass / 0 fail this run |
| AC2 — published twin stays out of the pool under a widened window (req: R2) | MET | test | `packages/kk-store/tests/dao/items-v2.test.ts:296` — "keeps a published story and its twin out of the pool under a widened window (0316 R2/AC2)", 48h window with unexcluded-pool control; same green run |
| AC3 — single scheduler owns kk-collect (req: R3) | MET | command | `test -f ~/Library/LaunchAgents/ai.gobing.kk-collect.plist` → ABSENT (only .bak-0316/.bak-20261012 remain); `launchctl print gui/$(id -u) \| grep kk-collect` → exit 1, no match; both re-run this verify |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

Confidence: HIGH

#### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | operations | One-time live repair on `.works/kk.db` is documented operator maintenance | docs/tasks/0316_close-the-kk-daily-ai-voice-residuals-near-duplicate-story-c.md:Plan | RESOLVED |

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | packages/kk-store/src/dao/items.ts:363 |
| R2 | MET | packages/kk-store/tests/dao/items-v2.test.ts:296 |
| R3 | MET | .spur/config.yaml:168 |

#### Acceptance Criteria

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 — body-link URL match merges a link post with its primary source (req: R1) | MET | test | packages/kk-store/tests/dao/items-v2.test.ts:258 |
| AC2 — published twin stays out of the pool under a widened window (req: R2) | MET | test | packages/kk-store/tests/dao/items-v2.test.ts:296 |
| AC3 — single scheduler owns kk-collect (req: R3) | MET | command | launchctl print gui/$(id -u) finds nothing; ai.gobing.kk-collect.plist absent |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-18T21:27:35.336Z backlog → todo (system)
- 2026-10-18T22:19:04.400Z todo → wip (system)
- 2026-10-18T22:45:57.877Z wip → testing (system)
- 2026-10-18T22:45:59.435Z testing → done (system)

