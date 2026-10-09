---
schema_version: 1
id: "G32"
name: "kk-collect store v2: backtestable labels, item facts, story dedup, topic-scoped selections"
status: backlog
priority: P2
tags: []
created_at: "2026-10-09T01:26:20.180Z"
updated_at: "2026-10-09T01:27:38.796Z"
---

# G32: kk-collect store v2: backtestable labels, item facts, story dedup, topic-scoped selections

## Goal

Make the kk store backtestable and topic-aware in one schema cut-over (`0003_store_v2`, brainstorm Option B — `docs/plans/2026-10-08-kk-collect-store-v2-brainstorm.md`):

- every decision maker's answer is kept side by side, with its raw value, raw confidence, reason and cost, so the same item pool can later be re-labeled by another maker and compared;
- deterministic facts (engagement, body length, source tier, language, domain, story) become typed `items` columns, and judgments stay in `labels`;
- new judgment dimensions (china-politics, sensitivity, audience) prepare a normalized topic-selection logic and platform-moderation gating;
- a topic-scoped `selections` table, written as soon as a plan is made, ends the "yesterday's episode = the day before's" repeat. Root cause: `mark-used` is the voice2 DAG tail (`kk-daily-ai-voice2.yaml:643`), so only one run has ever been recorded.

## Scope

- In: one migration `0003_store_v2` (labels identity widened to `(item_id, decision_id, maker, run_id)` + `raw_value`, `raw_confidence`, `reason`, `duration_ms`, `catalog_version`, `content_hash`; `labels_current` as a DAO-compiled CTE (a static VIEW cannot read the configured maker priority); content-hash change no longer deletes labels — stale observations are kept and ignored by `labels_current`; `items` fact columns `engagement`, `body_chars`, `source_tier`, `lang`, `domain`, `story_id`; `selections` replacing `episode_usage` with backfill); freezing the `0001` DDL as literal SQL; maker-priority + kk-side confidence-threshold config; catalog `minConfidence: 0`; `kk store label --replay`; deterministic `story_id` clustering at ingest; `kk store select | mark-published | release`; topic+story exclusion in `kk store extract`; voice2 `select` node after `plan`; catalog decisions `kk-item-china-politics`, `kk-item-sensitivity`, `kk-item-audience`; ADR-030 amendment, design doc §2–§4, `docs/04_DESIGN.md`.
- Out: a `kk store compare` backtest report (deferred until data exists); per-platform publish gating on sensitivity/china-politics (a profile gate only); embedding or cross-language story clustering; selection cooldown/re-entry windows; deciding which non-voice2 lifecycle writes `selections` for future topics; retention/pruning.

## Acceptance Criteria

```gherkin
Feature: kk-collect store v2: backtestable labels, item facts, story dedup, topic-scoped selections

@core
Scenario: R1 — One migration upgrades a v1 store and a fresh store to the same schema
  # covers: I1
  Given a database migrated through 0002 holding items, labels and episode_usage rows, and an empty database file
  When kk store migrate runs on both
  Then both databases end with identical table, index and view definitions
  And every v1 label row survives as an observation and every episode_usage row becomes a published selection for topic ai-news
  And a second kk store migrate applies nothing and exits 0

@core
Scenario: R2 — Labels from different makers on the same item coexist
  # covers: I2
  Given an item already labeled for kk-item-category by maker A
  When maker B labels the same item for the same decision
  Then the store holds both observations, one per maker
  And re-running maker A in the same run replaces only maker A's row for that run

@core
Scenario: R3 — A model answer is stored raw even below the confidence threshold
  # covers: I3
  Given a model returns value V with confidence 0.42 and a reason
  When kk store label writes the observation
  Then the row stores raw_value V, raw_confidence 0.42, the reason, the consult duration and the catalog version
  And the row still carries the HIGH, MEDIUM or LOW confidence level

@core
Scenario: R4 — The current label follows maker priority and the kk threshold
  # covers: I4
  Given observations for one item and decision from makers ranked by the configured priority
  When labels_current is read
  Then it returns the highest-priority maker whose raw_confidence meets the kk threshold, the latest one on a tie
  And a below-threshold model answer falls through to the next maker or the heuristic
  And a per-decision priority override wins over the global priority

@core
Scenario: R5 — Replay re-labels a historical pool without disturbing production selection
  # covers: I5
  Given labeled items from earlier collect runs and a maker ranked below the production maker
  When kk store label --replay with a topic, run or since selector and that maker runs
  Then every selected item gains observations from that maker
  And no existing observation is changed and the extract result for the topic is unchanged

@core
Scenario: R6 — Ingest records deterministic item facts as typed columns
  # covers: I6
  Given Docs whose metadata carries engagement, publish date, source and body
  When kk store ingest runs
  Then each item row stores engagement, body_chars, source_tier, lang and domain as typed columns
  And the heuristic dimension scores computed from those columns equal the scores computed from the Doc metadata

@core
Scenario: R7 — Near-duplicate titles within 72 hours share one story
  # covers: I7
  Given a stored item whose title reports an event, and a new item from another URL reporting the same event in near-identical wording
  When the new item is ingested within 72 hours of the first
  Then it inherits the first item's story_id
  And a same-wording item outside the 72-hour window, or a different-event title, gets its own story_id
  And Chinese titles cluster by character bigrams and Latin titles by words

@core
Scenario: R8 — A planned item is excluded the next day even when the run never publishes
  # covers: I8
  Given a daily run that planned items for topic ai-news and then failed before publishing
  When the next daily run extracts its pool
  Then the planned items' stories are excluded
  And their selections are recorded with status selected, the run id, rank and workflow

@core
Scenario: R9 — Exclusion is per topic and per story
  # covers: I9
  Given story S was selected for topic ai-news through item A
  When the ai-news pool is extracted with item B of story S available
  Then item B is excluded
  And when another topic's pool is extracted, items of story S remain eligible

@edge
Scenario: R10 — Releasing a run returns its items to the pool
  # covers: I8
  Given a run whose selections are in status selected
  When kk store release --run with that run id executes
  Then those selections move to dropped and their stories become extractable again
  And published selections are never released

@core
Scenario: R11 — New judgment decisions label every new item, and china-politics gates conservatively
  # covers: I10
  Given the catalog defines kk-item-china-politics (0-3, scoped to China's political system and institutions and the top leader's personal information), kk-item-sensitivity (0-3) and kk-item-audience (general, practitioner, researcher)
  When kk store label processes new items
  Then each item gets an observation for all three decisions
  And an item about a Chinese AI company's product release scores china-politics 0
  And when no maker answers china-politics for an item, the ai-news profile's china-politics gate excludes the item rather than admitting it

@core
Scenario: R12 — Two consecutive daily dry runs produce disjoint pools
  # covers: I8, I9
  Given a store with enough labeled items for two pools
  When kk-daily-ai-voice2 runs twice in dry-run mode over the same store
  Then the second run's selected stories share no story_id with the first run's
  And a repeatable artifact recording both pools lands under .works/test-artifacts/

@core
Scenario: R13 — Decision and surface docs record store v2
  # covers: I11
  Given the change set that ships store v2
  When docs/00_ADR.md, docs/design/kk-collect-and-daily-voice2.md and docs/04_DESIGN.md are inspected
  Then ADR-030 carries a dated amendment for the labels identity, item facts and selections
  And 04 lists kk store select, mark-published, release and label --replay, and no longer lists mark-used or --exclude-used
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0225 | kk-store v2 schema: single 0003_store_v2 migration, frozen 0001 DDL, labels observations, item facts, selections | todo |
| 0226 | kk store label v2: raw observations, maker priority + kk threshold, labels_current extract, --replay | todo |
| 0227 | kk store ingest v2: typed item facts and deterministic story_id clustering | todo |
| 0228 | Topic-scoped selections: kk store select, mark-published, release; story exclusion; voice2 select node | todo |
| 0229 | New item decisions: kk-item-china-politics, kk-item-sensitivity, kk-item-audience with conservative gate | todo |
| 0230 | Store v2 cut-over: live-store migration dogfood, two-run disjoint-pool E2E, design doc sync | todo |
<!-- END AUTO-GENERATED -->

## Notes

Requirement inventory (from the 2026-10-08 brainstorm, operator-confirmed decisions D1–D8):

- I1 — one schema cut-over (Option B), with v1 data preserved.
- I2 — labels append-only per maker (D1).
- I3 — raw value, raw confidence (the "p-value" ask is spur's 0–1 confidence), reason and cost captured (D1, D7).
- I4 — the effective label is chosen by configured maker priority plus the kk threshold (D6, D7).
- I5 — replay for backtesting; the compare report is deferred (D8).
- I6 — facts into typed item columns, judgments into labels (D2).
- I7 — deterministic story clustering; `ponytail:` no cross-language merge, the upgrade path is embeddings (D5).
- I8 — selections written at plan time and releasable (D4, root cause).
- I9 — topic- and story-scoped exclusion; one item may serve many topics (D4).
- I10 — new decisions china-politics, sensitivity and audience (D3, D3a). china-politics exists to avoid platform moderation rejection, NOT to exclude China-related content.
- I11 — ADR/design/04 sync.

Design source: `docs/plans/2026-10-08-kk-collect-store-v2-brainstorm.md`.

## History
