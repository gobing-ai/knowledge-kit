---
schema_version: 1
name: "kk-store v2 schema: single 0003_store_v2 migration, frozen 0001 DDL, labels observations, item facts, selections"
status: todo
template: feature-impl
created_at: 2026-10-09T01:27:19.348Z
updated_at: "2026-10-09T02:45:21.386Z"
feature_id: G32

priority: P1
estimate_hours: 6
---

## 0225. kk-store v2 schema: single 0003_store_v2 migration, frozen 0001 DDL, labels observations, item facts, selections

### Background

G32 store v2 lands as ONE schema cut-over (brainstorm Option B, operator decision 2026-10-08 — `docs/plans/2026-10-08-kk-collect-store-v2-brainstorm.md`). This task owns the schema, the migration and the DAOs. Every other G32 task builds on it.

Current constraints:

- `labels` is UNIQUE on `(item_id, decision_id)` (`packages/kk-store/src/schema/index.ts:35`) and upserted (`dao/labels.ts:upsertLabel`), so a second maker overwrites the first.
- `ItemsDao` deletes an item's labels when its `content_hash` changes (`dao/items.ts:199`), which destroys backtest evidence.
- `0001`'s DDL is DERIVED from the live `defineTable` builders (`migrations.ts:18-23`). That convergence trick only works for ADD COLUMN. Widening an identity breaks it, so `0001` must be frozen as literal v1 SQL first.
- `episode_usage` is keyed by workflow, not topic. It is replaced by `selections`.

**Refine corrections (2026-10-08)**

- The `0001` derivation comment is at `migrations.ts:17-24`, not `:18-23`. The labels UNIQUE index is at `schema/index.ts:36`, not `:35`.
- **Premise was false:** "all inside the migrator's per-migration transaction". `applyKkMigrations` (`migrations.ts:107-130`) runs each statement through its own `adapter.exec`, with no transaction. Its race comment says "every statement above is idempotent". That holds for `0001`/`0002` but not for a table rebuild. The Design section now freezes atomic application for `0003`.
- Live store, re-measured at refine time (`.works/kk.db`):
  - `episode_usage` has **0** rows (the brainstorm cited one run).
  - `labels` has 340 rows, and none has a NULL `run_id`.
  - Makers: `heuristic` 320, `fm-local` 17, `laya-local` 3. Sources: heuristic, model, default.
  - Each `(item_id, decision_id)` pair holds exactly one row, so the rebuild copy has no identity collision.
- R2(b): the `domain` SQL derivation is removed. String-slicing a URL in SQLite is fragile. 0227's `kk store backfill-facts` derives `domain` with `new URL()` instead.
- Additional impacted files the original scope missed:
  - `src/db.ts:2,19,58` (the `usage` DAO slot)
  - `src/index.ts:19`
  - `src/profile.ts:67` (`excludeUsed`)
  - `src/dao/items.ts:285` (`episode_usage` NOT EXISTS)
  - `apps/cli/src/commands/store.ts:739` (`upsertLabel` call)
  - tests `packages/kk-store/tests/{kk-store.test.ts:86-93, dao/labels.test.ts, dao/items.test.ts, dao/episode-usage.test.ts}` and `apps/cli/tests/store-extract.test.ts`

### Requirements

- [ ] R1. Freeze `0001_kk_store_init` as literal SQL: the exact v1 DDL that the builders produce today, including the `0002` columns (TEXT `confidence`, `run_id`). It no longer derives from builders. The existing fresh-vs-migrated oracle (`tests/migrations.test.ts`) still passes for `0001`+`0002`.
- [ ] R2. Add `0003_store_v2` as one migration, applied **atomically**: all statements plus the journal row in one `adapter.batch`. It must be race-safe against a concurrent migrator.
  - **(a) labels.** Rebuild with identity UNIQUE `(item_id, decision_id, maker, run_id)`, where `run_id` is NOT NULL and a legacy null becomes `'legacy'`. New columns: `raw_value TEXT`, `raw_confidence REAL`, `reason TEXT`, `duration_ms INTEGER`, `catalog_version TEXT`, and `content_hash TEXT` (the item hash the observation was made against, backfilled from `items.content_hash`). Index on `(item_id, decision_id)`.
  - **(b) items.** New columns `engagement REAL`, `body_chars INTEGER`, `source_tier TEXT`, `lang TEXT`, `domain TEXT`, `story_id TEXT`, plus an index on `story_id`. Backfill `story_id = id` and `body_chars = length(body)`. The other facts stay NULL until 0227's `backfill-facts`, which also derives `domain` via `new URL()`.
  - **(c) selections.** UNIQUE `(topic, item_id, run_id)`, plus `story_id`, `workflow`, `rank INTEGER`, `reason TEXT`, `status TEXT` CHECK in (`selected`, `published`, `dropped`), `selected_at`, `published_at`, and the standard columns. Index `(topic, story_id, status)`.
  - **(d) episode_usage.** Copy every row into `selections` as `topic='ai-news'`, `status='published'`, `story_id = item_id`. Then drop the table and its two indexes.
- [ ] R3. Update the schema builders (`src/schema/*.ts`) so they describe v2 exactly. A test asserts that a fresh DB (`0001`→`0003`) and a v1 DB carrying data end with identical `sqlite_master` definitions, column types included.
- [ ] R4. `LabelsDao`:
  - `recordObservation(input)` — an upsert on the 4-column identity that writes only the owning row;
  - `listForItem(itemId)`;
  - `observations(filter: { decisionId?, maker?, runId?, since? })`.

  Remove `upsertLabel`.
- [ ] R5. `ItemsDao.ingest` stops deleting labels on a content-hash change (today `dao/items.ts:199`). It still counts the item as `updated`, so the label pass re-labels it, and the old observations keep their own `content_hash`.
- [ ] R6. Add `SelectionsDao`: `insertMany`, `updateStatus(runId, topic, status, itemIds?)`, `listByRun`, `excludedStories(topic)`. Delete `EpisodeUsageDao`, `schema/episode-usage.ts` and the `usage` slot on the store handle (`db.ts`). Adapt callers just enough to compile and keep tests green; the CLI surface changes belong to 0228.
- [ ] R7. Write a dated ADR-030 amendment in `docs/00_ADR.md` covering the labels observation identity, item facts vs judgments, `selections` replacing `episode_usage`, frozen `0001`, and atomic rebuild migrations. Write it before code diverges.

### Acceptance Criteria

- [ ] AC1 — One migration upgrades a v1 store and a fresh store to the same schema
- [ ] AC2 — Labels from different makers on the same item coexist

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T02:36:27.581Z

- **Q: Is the per-statement migrator safe for a table rebuild?** No (refine audit). Closed: `atomic` migrations run as one `adapter.batch`, with the journal row inserted first, so a racing migrator rolls back instead of rebuilding twice.
- **Q: Should SQL derive `domain` in `0003`?** No. Closed: 0227 derives it with `new URL()`, which is one implementation and not fragile.

### Design

**Frozen names**:

| Kind | Names |
|---|---|
| Migration ids | `0001_kk_store_init` (frozen literal), `0002_labels_confidence_run_id` (unchanged), `0003_store_v2` |
| Constant | `KK_STORE_V1_SQL_FROZEN` in `src/migrations.ts`. `KK_STORE_V1_SQL` is deleted. |
| Indexes | `labels_observation_unique` (item_id, decision_id, maker, run_id) · `labels_item_decision_idx` (item_id, decision_id) · `items_story_idx` (story_id) · `selections_identity_unique` (topic, item_id, run_id) · `selections_topic_story_status_idx` (topic, story_id, status) |
| DAO | `store.labels.recordObservation` / `listForItem` / `observations`, `store.selections.insertMany` / `updateStatus` / `listByRun` / `excludedStories` |
| Legacy run id | the literal `'legacy'` |

**Atomic migration.** `KkMigration` gains `atomic?: boolean`. When it is set, `applyKkMigrations` builds a single `adapter.batch` from:

1. a plain journal `INSERT INTO __kk_store_migrations (id, applied_at) VALUES (?, ?)`, with **no** ON CONFLICT and placed **first**;
2. every split statement.

`adapter.batch` is one transaction (`ItemsDao.ingest` already relies on that, `dao/items.ts:147-152`). A losing concurrent process therefore fails, either on the journal's PRIMARY KEY or on SQLITE_BUSY, and rolls back whole. The migrator catches the error, re-reads the journal, and treats "id now present" as applied by the other process. Any other failure is rethrown.

Non-atomic migrations (`0001`, `0002`) keep today's per-statement `exec` path and its duplicate-column tolerance.

**Rebuild.** The labels rebuild runs `CREATE TABLE labels_v2 … ; INSERT INTO labels_v2 SELECT … ; DROP TABLE labels ; ALTER TABLE labels_v2 RENAME TO labels ; CREATE … INDEX …`. The migrator splits on `;`, so no statement may contain a literal `;`.

**Other decisions**:

- The `0001` freeze is copied verbatim from what the builders produce **before** any builder edit. Plan step 3 asserts this by diffing against the pre-change `KK_STORE_V1_SQL`.
- `raw_confidence` is REAL, the raw 0–1 number. The `confidence` enum column stays, because the G31 R14 consumers read it.
- No SQL VIEW. `labels_current` needs the configured maker priority, so 0226 compiles it as a CTE in the DAO.

**Anti-patterns**:

- Deriving `0001` from builders again.
- Applying `0003` statement-by-statement.
- `ON CONFLICT DO NOTHING` on the `0003` journal insert. It would let a loser re-run the rebuild.
- Keeping `upsertLabel` as an alias.
- A SQL VIEW for `labels_current`.

**Handoffs**:

- **0226** consumes `recordObservation` and `observations`.
- **0227** fills the NULL fact columns and `domain`.
- **0228** consumes `SelectionsDao` and removes the `mark-used` / `--exclude-used` surface. Until then, 0225 may keep `--exclude-used` compiling by mapping it to `excludedStories('ai-news')`.

**Impacted**:

- `packages/kk-store/src/{migrations.ts, schema/*, dao/{labels,items}.ts, dao/selections.ts (new), db.ts, index.ts, profile.ts}`
- deleted: `dao/episode-usage.ts`, `schema/episode-usage.ts`, `tests/dao/episode-usage.test.ts`
- compile-only: `apps/cli/src/commands/store.ts`
- tests listed in Background

### Plan

1. Write the failure-first list in Testing: migration on a DB with null `run_id`; duplicate `(item, decision)` rows across makers; `episode_usage` duplicates; re-running `0003`; fresh-vs-migrated drift; the content-hash change path.
2. Write the ADR-030 amendment.
3. Freeze `0001`, run the existing tests, and confirm they are green.
4. Update the builders, write `0003`, and extend the convergence oracle with a data-carrying v1 fixture.
5. Change the DAOs (`LabelsDao`, `ItemsDao`, `SelectionsDao`) and delete `EpisodeUsageDao`.
6. Run `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: `docs/features/G32_*.md`. Brainstorm: `docs/plans/2026-10-08-kk-collect-store-v2-brainstorm.md` (D1, D2, D4).
- `packages/kk-store/src/migrations.ts:17-24` (derived `0001`), `:107-130` (per-statement apply, journal race); `src/schema/index.ts:31-39`; `src/dao/items.ts:147-152,199,285`; `src/db.ts:2,19,58`; `src/profile.ts:67`; `apps/cli/src/commands/store.ts:739`.
- Adapter atomicity: `@gobing-ai/ts-db@0.5.18` `dist/adapter.d.ts:46-52` (`batch` runs in a single transaction).

### History

- 2026-10-09T02:45:13.939Z backlog → todo (system)

