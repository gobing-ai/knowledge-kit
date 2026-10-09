---
title: kk-collect store v2 — backtestable labels, fact columns, topic-scoped selections
date: 2026-10-08
kind: plan
tags: [brainstorm, kk-collect, kk-store, G31]
needs_design: true
run_id: inline
---

# Brainstorm: kk-collect store v2

**Date:** 2026-10-08

## Overview

`kk-collect` writes `items` + `labels` into `kk.db`; `kk-daily-ai-voice2` extracts a pool from them and
records usage in `episode_usage`. Three gaps block the next stage of the product:

1. **Labels cannot be backtested.** `labels` is UNIQUE on `(item_id, decision_id)` and upserted
   (`packages/kk-store/src/schema/index.ts:35`, `dao/labels.ts:upsertLabel`), so a second maker
   overwrites the first. The raw 0–1 confidence, `reason` and `durationMs` are dropped at the emit
   boundary (`apps/cli/src/commands/store.ts:586-606`). Below `minConfidence: 0.8` the model's answer
   is replaced by the fallback (`plugins/kk/decisions/kk-items.yaml:16`).
2. **Facts and judgments are mixed.** The four heuristic scores are pure functions of facts (body
   length, source tier, publish date, engagement) that live untyped in `metadata_json`.
3. **Daily content repeats.** Root cause: `mark-used` is the DAG tail
   (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:643-660`, after `publish-classify`). Any run that
   fails or stops before that point records nothing. The live store has `episode_usage` rows from
   exactly one run (2026-10-08 22:27). `episode_usage` is also keyed by workflow rather than topic,
   and has no story-level dedup.

Live store snapshot (`.works/kk.db`): 68 items, 340 labels (320 heuristic/LOW, 12 model/HIGH, 8
default/LOW), 3 collect runs. Any migration is cheap.

## Decision Tree (resolved in discovery)

| # | Decision | Resolved | Basis |
|---|---|---|---|
| D1 (root) | Labels row identity | Append-only observations, UNIQUE `(item_id, decision_id, maker, run_id)`. New columns: `raw_value`, `raw_confidence REAL`, `reason`, `duration_ms`, `catalog_version`. Keep the enum `confidence`. VIEW `labels_current` | F1/F2: upsert destroys cross-maker evidence |
| D2 | items vs labels | Deterministic facts go to typed `items` columns: `engagement`, `body_chars`, `source_tier`, `lang`, `domain`, `story_id`. Anything a maker could disagree on goes to `labels` | One rule instead of case-by-case. Fact columns also serve as backtest signals |
| D3 | New judgment dimensions | `kk-item-china-politics` (0–3), `kk-item-sensitivity` (0–3), `kk-item-audience` (choice `general\|practitioner\|researcher`), plus the `story_id` fact (D5) | Operator + recommendation |
| D3a | china-politics scope | Narrow: China's current political system and institutions, and the top leader's personal information. Purpose: avoid platform moderation rejection, **not** exclude China-related content. 0 none · 1 factual policy/government mention (CAC filing, export rule) · 2 commentary on system/institutions · 3 top-leader personal info or direct critique of the system. Per-platform thresholds live in profile/publish config | Operator clarification |
| D4 | Selection table | `selections` replaces `episode_usage`. UNIQUE `(topic, item_id, run_id)`, plus `story_id`, `workflow`, `rank`, `reason`, `status` (`selected`→`published` \| `dropped`), `selected_at`, `published_at`. Written right after `plan`, updated at `publish-classify`. Extraction excludes by `(topic, story_id)` with status in `selected`/`published`. `kk store release --run <id>` marks a failed run's rows `dropped` | F4 root cause; one item may serve many topics |
| D5 | story_id | Deterministic at ingest: normalized-title token Jaccard (CJK char bigrams, Latin words) against items from the last 72h. Above the threshold, inherit that story's id; otherwise `story_id = id`. `ponytail:` no cross-language merge; upgrade path is embeddings | Zero cost, unit-testable |
| D6 | `labels_current` pick | Configured maker priority (global list plus optional per-decision override); ties go to latest `labeled_at` | Backtest runs must not pollute production |
| D7 | Below-threshold answer | kk catalog `minConfidence: 0`. spur always returns the model answer, and kk enforces its threshold in `labels_current` (`raw_confidence >= kk threshold`, else fall through to the next maker/heuristic) | No spur change; thresholds re-tunable offline |
| D8 | Backtest scope | Capture plus `kk store label --replay <topic\|run\|since> --maker X`. A `kk store compare` report is deferred until data exists | Pick metrics after seeing data |

## Approaches

All three implement D1–D8. They differ in **delivery and migration strategy**.

### ⭐ A — Phased in-place migrations, root-cause fix first

Four slices, each a migration plus code, shippable independently:

| Slice | Ships | Migration |
|---|---|---|
| S1 selections | `selections` table + DAO; `kk store select --topic --run --in plan.json` (status `selected`) as a node right after `plan`; `publish-classify` → `kk store mark-published`; `kk store release --run`; extract excludes by `(topic, story_id)` (`story_id` temporarily = `item_id` until S3); backfill `episode_usage` rows as `published`; drop `episode_usage` | `0003_selections` |
| S2 labels v2 | Drop `labels_item_decision_unique`, create UNIQUE `(item_id, decision_id, maker, run_id)`; add the raw columns; `labels_current` VIEW driven by maker priority; extract compiles against the view; `minConfidence: 0` + kk threshold; `--replay` | `0004_labels_observations` |
| S3 item facts | Typed fact columns, populated at `kk store ingest` and backfilled from `metadata_json`; `story_id` clustering; heuristic scores become pure functions of fact columns | `0005_item_facts` |
| S4 new decisions | Catalog entries china-politics / sensitivity / audience; label pass routes them to the model (the heuristic has no signal for them); profile `where` gains e.g. `kk-item-china-politics: { lte: 1 }` per platform | catalog only |

- **Pros:** S1 alone fixes the operator-visible bug within days. Each slice has its own gate and
  rollback. The ADD-COLUMN migration style matches `0002`.
- **Cons:** Four migrations. The `0001`-derived-from-builder convergence trick (`migrations.ts:20`)
  breaks once the labels identity changes, so `0001` DDL must be **frozen** as literal SQL from S2
  on (one-time cost).
- **Confidence:** HIGH. Every slice reuses existing patterns (defineTable, EntityDao, the profile
  compiler at `packages/kk-store/src/profile.ts`).

### B — Single v2 migration (rebuild tables, one cut-over)

One `0003_store_v2` migration creates `labels_v2`/`selections`/new item columns, copies data,
drops the old tables and renames. All code changes land in one PR.

- **Pros:** One schema version to reason about. Only one convergence break.
- **Cons:** The duplicate-content fix waits for the whole bundle. One large review. Rollback means
  restoring the DB file.
- **Confidence:** MEDIUM. Mechanically fine at 68 rows; the risk is review size and delay.

### C — Shadow tables, dual-write, retire later

Add `label_observations` + `selections` beside the existing tables. Write both; extract switches
over after N days of parity.

- **Pros:** Zero-risk read path during the transition.
- **Cons:** Two sources of truth and a later retire task. Dual-write code nobody wants. Shadowing
  buys nothing for a single-operator store with 340 rows.
- **Confidence:** LOW value (it works, but over-engineered for this scale).

## Decision (operator, 2026-10-08)

**B chosen.** kk-collect only just shipped, so the live store holds 68 items / 340 labels and the
migration cost that favoured A does not exist. One `0003_store_v2` migration, one cut-over.
Planned as feature G32 (under G3). U1 is resolved: the spur catalog schema accepts
`minConfidence` 0–1 at both defaults and per-decision level
(`@gobing-ai/spur/schemas/decision-catalog.schema.json`).

## Original recommendation (superseded)

**A.** Ship S1 first: it is the root-cause fix for repeated content and is independent of S2–S4.
S2 → S3 → S4 follow in order. S4 depends on S2, because new model-only decisions need raw capture
to be backtestable. S3 is independent of S2 and can run in parallel.

## Design Summary

- **Schema:** `selections` (new, replaces `episode_usage`); `labels` becomes append-only with
  identity `(item_id, decision_id, maker, run_id)`, the raw columns, and the `labels_current` VIEW;
  `items` gains `engagement`, `body_chars`, `source_tier`, `lang`, `domain`, `story_id` (indexed).
- **Surface (docs/04 same commit):** `kk store select`, `kk store mark-published`,
  `kk store release`, `kk store label --replay`. `kk store mark-used` and `--exclude-used` are
  replaced by topic-scoped equivalents. `extract` reads `labels_current` and excludes by story.
- **Config:** maker priority (`decisions.priority` + per-decision override) and the kk-side
  confidence threshold, read through the existing kk config loader.
- **Workflows:** voice2 gains a `select` node after `plan`; `mark-used` becomes `mark-published`.
  kk-collect is unchanged apart from ingest computing facts and `story_id`.
- **Docs:** ADR-030 amendment (labels identity, selections), `docs/design/kk-collect-and-daily-voice2.md`
  §2/§3/§4, `docs/04_DESIGN.md`.
- **Tests (failure-first lists before code):** migration convergence on fresh vs migrated DB;
  `labels_current` priority/threshold fall-through; story Jaccard (CJK/Latin/near-miss); exclusion
  across topics (an item selected for topic A is still eligible for topic B); release frees items;
  E2E: two consecutive voice2 dry runs over the same store produce disjoint pools (the repeatable
  artifact).

## Open Questions / Unverified

- **U1 (resolved):** spur's decision-catalog schema accepts `minConfidence` in `[0, 1]` (defaults and
  per decision).
- **U2:** the `story_id` Jaccard threshold (start at 0.6) is a calibration knob. Tune on the live
  store's 68 items.
- **U3:** which lifecycle writes `selections` (voice2 vs a future generic `kk select` stage) was
  deferred by the operator. S1 wires it into voice2 only.

## Next Steps

1. Operator reviews this doc (user review gate).
2. `/sp:dev-brainstorm … --feature G31` or `spur feature create` under G31 with S1–S4 as scope, then
   `/sp:dev-plan --feature <id>`. S1 should be the first task.
3. Verify U1 before planning S2.
