---
schema_version: 1
id: "G31"
name: "kk-collect: SQLite store, 4h collection, decision labels, topic extraction"
status: done
priority: P2
tags: []
created_at: "2026-10-07T03:50:34.546Z"
updated_at: "2026-10-07T19:18:14.893Z"
---

# G31: kk-collect + kk-daily-ai-voice2: SQLite store, decision labels, DAG daily workflow, run ledger

## Goal

Take data collection off the daily-episode critical path and make collected content a durable, labeled, multi-topic asset: a 4-hourly `kk-collect` workflow persists every ingested item into a migrated SQLite store (`@gobing-ai/ts-db`), tags new items through a `spur decision` label catalog, and serves deterministic topic pools (ai-news first) to downstream workflows with cross-day usage dedup.

## Scope

- In: `@gobing-ai/kk-store` package (ts-db adapter, drizzle tables, DAOs, embedded migrations, WAL + busy_timeout); `store.db_path` in `~/.config/kk/config.yaml` (default `.works/kk.db`); `spur rule` boundary rules confining ts-db/drizzle to the package; `kk store migrate|lock|ingest|label|extract|mark-used`; `kk-collect` state-machine with single-flight lock; launchd/cron templates + `kk schedule render`; kk decision catalog (category choice + four score decisions) with heuristic-first labeling; topic extraction profiles; ADR-030.
- Out: the daily DAG workflow (G11); the run ledger (G71); retiring `kk-daily-ai-voice.yaml`; backfilling historical per-day JSON; DB retention; new ingestion sources; a scheduler inside spur or kk.

## Acceptance Criteria

```gherkin
Feature: kk-collect — SQLite store, 4h collection, decision labels, topic extraction

@core
Scenario: R1 — kk-collect runs ingestion standalone and persists every item to the store
  # covers: I1, I4
  Given configured ingestion sources and an initialized kk store
  When the kk-collect workflow runs to completion
  Then every collected Doc is upserted into the items table with its collect-run id as provenance
  And the run still writes the markdown core-facts file under .works/kk-collect/<run-stamp>/
  And no generation, TTS, or publish step executes in kk-collect


@core
Scenario: R2 — Re-collecting an already stored item updates it without duplicating
  # covers: I1, I4
  Given an item already stored with canonical URL U and content hash H
  When a later kk-collect run returns a Doc with canonical URL U
  Then the items table still holds exactly one row for U
  And the row records last_seen for the later run and a new hash only when the body changed


@core
Scenario: R3 — Store path resolves from kk config with a works-dir default
  # covers: I5
  Given ~/.config/kk/config.yaml sets store.db_path to a custom path
  When any kk store command opens the database
  Then it opens the configured path, creating parent directories when absent
  And when store.db_path is unset it opens <works_dir>/kk.db


@core
Scenario: R4 — ts-db and drizzle imports are confined to the kk-store package
  # covers: I6, I7
  Given the boundary rules under .spur/rules/boundary/
  When spur rule run executes against the workspace
  Then any import of @gobing-ai/ts-db outside packages/kk-store fails the rule
  And any drizzle import outside packages/kk-store/src/schema fails the rule
  And the current tree passes both rules


@core
Scenario: R5 — Store schema evolves only through versioned migrations
  # covers: I7
  Given a fresh database file and the kk-store migration set
  When kk store migrate runs twice
  Then the first run applies every migration in order and records each in the migrations table
  And the second run applies nothing and exits 0
  And the database runs in WAL mode with a busy_timeout of at least 30000 ms


@core
Scenario: R6 — Overlapping collect runs are single-flight
  # covers: I19, I2
  Given a kk-collect run holding the collect lock
  When a second kk-collect run starts before the first finishes
  Then the second run exits 0 with a skipped-locked result and writes nothing to the store
  And a stale lock older than the configured TTL is reclaimed by the next run


@core
Scenario: R7 — A launchd/cron template schedules kk-collect every 4 hours
  # covers: I2
  Given the kk plugin's shipped scheduler templates
  When the operator renders the template for their platform
  Then the produced launchd plist (macOS) or crontab line invokes kk-collect at a 4-hour interval
  And the docs state that installing the schedule is an operator action


@core
Scenario: R8 — Newly inserted items are labeled through the kk decision catalog
  # covers: I8, I20
  Given the kk decision catalog defines item-category (choice) and quality, importance, urgency, impact (score)
  When kk-collect labels the items inserted by the current run
  Then each new item gets one label row per decision with value, maker, and source
  And items already labeled in earlier runs are not re-sent to any decision
  And spur decision status --json reports the catalog loaded with no load errors


@edge
Scenario: R9 — Decision backend failure falls back to the heuristic label and is recorded
  # covers: I20, I8
  Given the configured decision maker is unreachable
  When kk-collect labels new items
  Then each label row carries the keyword-heuristic value with source default
  And the collect run completes instead of failing


@core
Scenario: R10 — AI-news extraction selects the episode pool from labels
  # covers: I9, I13
  Given labeled items in the store across several collect runs
  When kk store extract --topic ai-news --window 24h runs
  Then it returns only items whose labels satisfy the ai-news extraction profile within the window
  And it reads only the store and performs no ingestion or labeling


@core
Scenario: R11 — A second topic is extractable without re-collecting
  # covers: I10
  Given an extraction profile for a topic other than ai-news added as data
  When kk store extract --topic <that topic> runs
  Then it returns items selected by that profile from existing labels
  And no code change to kk-store or the collect workflow is required


@core
Scenario: R12 — Items aired in an episode never re-enter a later pool
  # covers: I18
  Given episode E recorded items A and B as used
  When the next daily run extracts its pool
  Then A and B are excluded from the pool
  And the usage table links each used item to the episode run id


@core
Scenario: R13 — Architecture docs record the store decision
  # covers: I21
  Given the change set that ships kk-store and kk-collect
  When docs/00_ADR.md, docs/03_ARCHITECTURE.md, and docs/04_DESIGN.md are inspected
  Then ADR-030 records the kk-owned SQLite store with status shipped
  And 04 lists every kk store and kk schedule verb in the same commit as its code

@core
Scenario: R14 — Verdict and decision surfaces carry a HIGH, MEDIUM, or LOW confidence level
  # covers: I22
  Given a label or decision emitted by a kk-collect surface (the decision catalog or kk store label)
  When the consumer reads that label or decision
  Then it carries exactly one confidence level from HIGH, MEDIUM, and LOW
  And a label or decision whose confidence is missing or outside that enum is refused rather than treated as a pass
  And the refusal names the offending value

```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0206 | kk-store package: ts-db SQLite store, migrations, config path, boundary rules | done |
| 0208 | kk-collect workflow: standalone 4h collection into the store | done |
| 0209 | kk decision catalog and kk store label: heuristic-first item labeling | done |
| 0210 | kk store extract and mark-used: profile-driven topic pools with cross-day dedup | done |
| 0213 | Verify the confidence level (HIGH\|MEDIUM\|LOW) on kk-collect and kk-daily-ai-voice2 verdict and decision surfaces | done |
<!-- END AUTO-GENERATED -->

## Notes

Voice2 verdict surfaces are NOT covered here: G31 Scope puts the daily DAG workflow (G11) and the run ledger (G71) out of scope, so R14 is limited to kk-collect decisions. The kk-daily-ai-voice2 safety sub-workflow judge verdicts are G11 R9.

## History

- 2026-10-07T04:52:37.118Z moved Q → G31 (system)
- 2026-10-07T07:00:08.789Z backlog → active (system)
- 2026-10-07T19:18:14.018Z active → verifying (system)
- 2026-10-07T19:18:14.893Z verifying → done (system)

