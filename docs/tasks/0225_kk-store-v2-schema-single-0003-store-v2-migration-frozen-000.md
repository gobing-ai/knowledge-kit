---
schema_version: 1
name: "kk-store v2 schema: single 0003_store_v2 migration, frozen 0001 DDL, labels observations, item facts, selections"
status: done
template: feature-impl
created_at: 2026-10-09T01:27:19.348Z
updated_at: "2026-10-09T21:34:09.910Z"
feature_id: G32

priority: P1
estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0225-verdict.json
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

- [x] R1. Freeze `0001_kk_store_init` as literal SQL: the exact v1 DDL that the builders produce today, including the `0002` columns (TEXT `confidence`, `run_id`). It no longer derives from builders. The existing fresh-vs-migrated oracle (`tests/migrations.test.ts`) still passes for `0001`+`0002`.
- [x] R2. Add `0003_store_v2` as one migration, applied **atomically**: all statements plus the journal row in one `adapter.batch`. It must be race-safe against a concurrent migrator.
  - **(a) labels.** Rebuild with identity UNIQUE `(item_id, decision_id, maker, run_id)`, where `run_id` is NOT NULL and a legacy null becomes `'legacy'`. New columns: `raw_value TEXT`, `raw_confidence REAL`, `reason TEXT`, `duration_ms INTEGER`, `catalog_version TEXT`, and `content_hash TEXT` (the item hash the observation was made against, backfilled from `items.content_hash`). Index on `(item_id, decision_id)`.
  - **(b) items.** New columns `engagement REAL`, `body_chars INTEGER`, `source_tier TEXT`, `lang TEXT`, `domain TEXT`, `story_id TEXT`, plus an index on `story_id`. Backfill `story_id = id` and `body_chars = length(body)`. The other facts stay NULL until 0227's `backfill-facts`, which also derives `domain` via `new URL()`.
  - **(c) selections.** UNIQUE `(topic, item_id, run_id)`, plus `story_id`, `workflow`, `rank INTEGER`, `reason TEXT`, `status TEXT` CHECK in (`selected`, `published`, `dropped`), `selected_at`, `published_at`, and the standard columns. Index `(topic, story_id, status)`.
  - **(d) episode_usage.** Copy every row into `selections` as `topic='ai-news'`, `status='published'`, `story_id = item_id`. Then drop the table and its two indexes.
- [x] R3. Update the schema builders (`src/schema/*.ts`) so they describe v2 exactly. A test asserts that a fresh DB (`0001`→`0003`) and a v1 DB carrying data end with identical `sqlite_master` definitions, column types included.
- [x] R4. `LabelsDao`:
  - `recordObservation(input)` — an upsert on the 4-column identity that writes only the owning row;
  - `listForItem(itemId)`;
  - `observations(filter: { decisionId?, maker?, runId?, since? })`.

  Remove `upsertLabel`.
- [x] R5. `ItemsDao.ingest` stops deleting labels on a content-hash change (today `dao/items.ts:199`). It still counts the item as `updated`, so the label pass re-labels it, and the old observations keep their own `content_hash`.
- [x] R6. Add `SelectionsDao`: `insertMany`, `updateStatus(runId, topic, status, itemIds?)`, `listByRun`, `excludedStories(topic)`. Delete `EpisodeUsageDao`, `schema/episode-usage.ts` and the `usage` slot on the store handle (`db.ts`). Adapt callers just enough to compile and keep tests green; the CLI surface changes belong to 0228.
- [x] R7. Write a dated ADR-030 amendment in `docs/00_ADR.md` covering the labels observation identity, item facts vs judgments, `selections` replacing `episode_usage`, frozen `0001`, and atomic rebuild migrations. Write it before code diverges.

### Acceptance Criteria

- [x] AC1 — One migration upgrades a v1 store and a fresh store to the same schema
- [x] AC2 — Labels from different makers on the same item coexist

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

Implemented the G32 store-v2 schema cut-over (R1–R7). All work is the uncommitted diff in the worktree on branch `sp/runall-g32-5368`.

**Migration (R1/R2)**
- `packages/kk-store/src/migrations.ts:30` — `KK_STORE_V1_SQL_FROZEN` holds the exact v1 DDL the builders produced before this change (byte-identical: sha256 `1da46c7d…7751fc`, including the `0002` columns), so `0001` no longer derives from the builders.
- `packages/kk-store/src/migrations.ts:138` — `STORE_V2_SQL`, the 20 `;`-free statements of `0003_store_v2`: labels rebuild (rename aside, frozen v2 DDL, copy with `COALESCE(run_id,'legacy')` and `content_hash` joined from `items`, `labels_observation_unique` + `labels_item_decision_idx`); items fact columns + `items_story_idx` + `story_id = id` / `body_chars = length(body)` backfill; `selections` DDL with the `status` CHECK plus its two indexes; every `episode_usage` row copied as `topic='ai-news'`, `status='published'`, `story_id = item_id`, then the table goes (its indexes with it).
- `packages/kk-store/src/migrations.ts:253` — `applyAtomicMigration` builds one `adapter.batch`: plain journal `INSERT` first (no `ON CONFLICT`), then every statement, so a losing concurrent migrator rolls back whole. On failure the journal is re-read and an id that is now present counts as applied by the other process; anything else rethrows. `packages/kk-store/src/migrations.ts:186` holds the pid list; non-atomic `0001`/`0002` keep the per-statement path and its duplicate-column tolerance.

**Builders (R3)**
- `packages/kk-store/src/schema/labels.ts:38-51` — `run_id` NOT NULL plus the six raw-evidence columns (`raw_value`, `raw_confidence` REAL, `reason`, `duration_ms`, `catalog_version`, `content_hash`).
- `packages/kk-store/src/schema/items.ts:31` — `engagement` REAL, `body_chars`, `source_tier`, `lang`, `domain`, `story_id`.
- `packages/kk-store/src/schema/selections.ts:18-34` — new table (topic, item, run, story, workflow, rank, reason, status, selected_at, published_at).
- `packages/kk-store/src/schema/index.ts` now re-exports the five v2 builders only; the frozen v1 constant moved into the migrator (`packages/kk-store/src/migrations.ts:30`).

**DAOs (R4–R6)**
- `packages/kk-store/src/dao/labels.ts:120` — `recordObservation` upserts on `(item_id, decision_id, maker, run_id)` and writes only the owning row; `listForItem`; `packages/kk-store/src/dao/labels.ts:176` — `observations({decisionId, maker, runId, since})`. `upsertLabel` is removed, not aliased.
- `packages/kk-store/src/dao/items.ts:200` — a `content_hash` change no longer deletes the item's labels (the item still counts as `updated`). The insert seeds `story_id = id` (`packages/kk-store/src/dao/items.ts:81`), the interim invariant until 0227 clusters.
- `packages/kk-store/src/dao/items.ts:286` — exclusion is `excludeTopic` → `NOT EXISTS (… selections s WHERE s.topic = ? AND s.story_id = i.story_id AND s.status IN ('selected','published'))`, the SQL 0228 freezes.
- `packages/kk-store/src/dao/selections.ts:59-134` — `insertMany` (idempotent multi-row insert, returns the rows written), `updateStatus` (moves only `selected` rows; never a published/dropped one), `listByRun`, `excludedStories(topic)`.
- `packages/kk-store/src/db.ts:58` — the `usage` slot becomes `selections`; `packages/kk-store/src/index.ts:38` exports the new DAO.
- `packages/kk-store/src/profile.ts:68` and `packages/kk-store/src/profile.ts:85` — `excludeWorkflow` becomes `excludeTopic`.
- CLI compile-only adaptation (0228 owns the surface): `apps/cli/src/commands/store.ts:740` writes via `recordObservation`, `apps/cli/src/commands/store.ts:883` maps `--exclude-used` to `excludeTopic: 'ai-news'`, `apps/cli/src/commands/store.ts:979` writes the run's published ai-news selections.

**ADR (R7)**
- `docs/00_ADR.md:1171` — dated ADR-030 amendment (observation identity, item facts vs judgments, `selections` replacing `episode_usage`, frozen `0001`, atomic rebuild migrations), written before the code diverged.

**Tests (AC1/AC2)**
- AC1 — `packages/kk-store/tests/migrations.test.ts:276-291`: a fresh store (`0001`→`0003`) and a v1 store carrying data (built with `0001`+`0002`, then reopened so only `0003` applies) end with identical `PRAGMA table_info` for all five tables, identical table/index name sets, an identical journal, and identical stored SQL for the rebuilt tables.
- AC2 — `packages/kk-store/tests/dao/labels.test.ts:47`: two makers' observations on one item+decision coexist as separate rows; a later run of one maker is a third row.
- Confidence level domain (G31 R14) — `packages/kk-store/tests/migrations.test.ts:351` migrates a v1 store holding one observation per `HIGH | MEDIUM | LOW` (and one NULL), then asserts each level comes back verbatim and the column stays TEXT; `packages/kk-store/tests/dao/labels.test.ts:111` round-trips every level through `recordObservation`, and the AC1 convergence oracle asserts the level per surviving row.
- Supporting: atomic rollback (`packages/kk-store/tests/migrations.test.ts:213`), frozen-v1 shape, the `selections.status` CHECK and builder/migration column lockstep in the same file; R5 retention at `packages/kk-store/tests/dao/items.test.ts:68`; the new DAO suite at `packages/kk-store/tests/dao/selections.test.ts:19`.
- Test adaptations the cut-over forces (assertion updates only; nothing skipped or weakened): `apps/cli/tests/store-extract.test.ts` counts `selections` and asserts topic-scoped exclusion, `apps/cli/tests/commands/store.test.ts` expects `applied: 3` and the 0003 journal row, `apps/cli/tests/store-label.test.ts` asserts a repeat pass is idempotent only for the same `--run` (a later run is a new observation).

**Gate evidence (run in the worktree)**
- `bun run lint` → exit 0 (Biome + every workspace `tsc --noEmit`).
- `bun run test` → exit 0: 2221 pass, 2 skip, 0 fail (2223 tests / 125 files).
- `bun run build` → exit 0.
- `git status --porcelain` → only the files above plus the three new files.

**Deviations and residual risk**
- `--exclude-used <workflow>` now ignores the workflow value and scopes to the `ai-news` topic — the temporary mapping the task permits; 0228 replaces the flag with `--include-selected`.
- `SelectionsDao.excludedStories` has no production caller in this task: it is the 0226/0228 handoff API R6 requires, verified by tests.
- The `episode_usage`→`selections` copy is a plain insert: a v1 database holding two workflows' rows for the same (item, run) would collide on `(topic, item_id, run_id)` and `0003` would roll back whole. Live `episode_usage` is empty and run ids are workflow-scoped, so this is theoretical.
- The `items` fact columns stay NULL for new rows until 0227's `backfill-facts`; only `story_id` is seeded, as designed.

**Repair — bounded remediation hop, 2026-10-09**

Closes review finding 4 (P3: the closed `HIGH | MEDIUM | LOW` vocabulary was not enforced at the
storage boundary while the same migration CHECKed `selections.status`) and finding 5 (P4: a
pre-0213 legacy numeric confidence emerged from the rebuild as the bogus string `'0.87'`).

- `packages/kk-store/src/migrations.ts:100-118` — the frozen `LABELS_V2_DDL` gains the table constraint
  `CHECK ("confidence" IN ('HIGH','MEDIUM','LOW') OR "confidence" IS NULL)` (migration-only, exactly
  as `selections.status`; the doc comment above the DDL now says so).
- `packages/kk-store/src/migrations.ts:156` — the legacy copy maps the level through
  `CASE WHEN l."confidence" IN ('HIGH','MEDIUM','LOW') THEN l."confidence" ELSE NULL END`: a level
  migrates verbatim, a hand-seeded `NULL` stays `NULL`, and any other legacy value (the pre-0213
  numeric payload, which v1's TEXT affinity stored as the string `'0.87'`) becomes `NULL` instead of
  a bogus level. The `0003` body stays `;`-free and one `adapter.batch`; `KK_STORE_V1_SQL_FROZEN` is
  untouched (sha256 `1da46c7d…7751fc`, re-checked this pass).
- `packages/kk-store/src/schema/labels.ts:36-37` — the builder documents the CHECK as a
  migration-only table constraint `defineTable(name, columns)` cannot express, mirroring
  `packages/kk-store/src/schema/selections.ts:14-16`. The builder↔migration lockstep test compares
  column name+type only, so it is unaffected.
- New failure-first tests (written failing, then green):
  `packages/kk-store/tests/migrations.test.ts:389-396` — a legacy row holding the numeric `0.87` (pinned
  as the string `'0.87'` before migration) and one holding `'high'` both migrate to `NULL`, while
  `'HIGH'` stays verbatim; `packages/kk-store/tests/migrations.test.ts:442-459` — a raw write of
  `'BOGUS'` or `'high'` is rejected by the migrated schema, while `HIGH` / `MEDIUM` / `LOW` / `NULL`
  stay writable. The AC1 convergence oracle, the frozen-`0001` test and the `;`-free/atomic
  expectations all stay green.
- Trade-off: the legacy numeric payload is dropped rather than salvaged into `raw_confidence`
  (the finding's suggested fix and this hop's scope both require `NULL`), so `raw_confidence` stays
  `NULL` for migrated rows.
- Gate evidence this pass (worktree `sp/runall-g32-5368`): `bun run lint` exit 0; `bun run test`
  exit 0 (2223 pass, 2 skip, 0 fail — 2225 tests / 125 files); `bun run build` exit 0.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-store/src/migrations.ts:30` declares the literal `KK_STORE_V1_SQL_FROZEN`, bound as `0001_kk_store_init` at `packages/kk-store/src/migrations.ts:198`; the v1 oracle `packages/kk-store/tests/migrations.test.ts:201` (fresh DB applies 0001–0003, 0002 duplicate ALTERs skipped) and `packages/kk-store/tests/migrations.test.ts:266` (frozen v1 shape) green this run. Re-anchored: prior citations `:197`, `:174`, `:239` had drifted after 0239/0242 edits. |
| R2 | MET | `STORE_V2_SQL` at `packages/kk-store/src/migrations.ts:144`, legacy confidence CASE `packages/kk-store/src/migrations.ts:156`, episode_usage copy `packages/kk-store/src/migrations.ts:178` and drop `packages/kk-store/src/migrations.ts:184`; `0003_store_v2` registered `atomic: true` at `packages/kk-store/src/migrations.ts:206`; one-batch apply with journal re-read on failure in `applyAtomicMigration` `packages/kk-store/src/migrations.ts:264`. Tests green this run: rollback-whole `packages/kk-store/tests/migrations.test.ts:223`, selections status CHECK `packages/kk-store/tests/migrations.test.ts:453`, concurrent openers `packages/kk-store/tests/kk-store.test.ts:185`. |
| R3 | MET | Builders describe v2: `packages/kk-store/src/schema/labels.ts:42` (`run_id` notNull) with raw columns from `packages/kk-store/src/schema/labels.ts:45`, `packages/kk-store/src/schema/items.ts:34` (`body_chars`) and `packages/kk-store/src/schema/items.ts:42` (`story_id`), `packages/kk-store/src/schema/selections.ts:18`; exports `packages/kk-store/src/schema/index.ts:10-14`. Convergence oracle `packages/kk-store/tests/migrations.test.ts:309` and builder/DDL lockstep (strengthened by 0239 R2) `packages/kk-store/tests/migrations.test.ts:527` green this run. |
| R4 | MET | `recordObservation` `packages/kk-store/src/dao/labels.ts:249`, `listForItem` `packages/kk-store/src/dao/labels.ts:296`, `observations` `packages/kk-store/src/dao/labels.ts:305`; `rg upsertLabel packages apps` → 0 source hits this run. Tests `packages/kk-store/tests/dao/labels.test.ts:34` (in-place update for same identity) and `packages/kk-store/tests/dao/labels.test.ts:143` (filters) green. |
| R5 | MET | Hash-change branch `packages/kk-store/src/dao/items.ts:262` counts the item updated; the R5 comment `packages/kk-store/src/dao/items.ts:195` documents no label delete; `rg -i "delete from .?labels" packages/kk-store/src apps/cli/src` → 0 hits this run. Test `packages/kk-store/tests/dao/items.test.ts:68` green. |
| R6 | MET | `SelectionsDao.insertMany` `packages/kk-store/src/dao/selections.ts:59`, `updateStatus` `packages/kk-store/src/dao/selections.ts:93`, `listByRun` `packages/kk-store/src/dao/selections.ts:114`; store slot `packages/kk-store/src/db.ts:30`, export `packages/kk-store/src/index.ts:54`; `excludeTopic` `packages/kk-store/src/profile.ts:73`. `rg "EpisodeUsageDao |
| R7 | MET | `docs/00_ADR.md:1182` — "Amendment — 2026-10-09 (G32 store v2: observation identity, item facts, topic-scoped selections, frozen DDL, atomic rebuilds)", covering all five topics. Re-anchored from `:1171`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — One migration upgrades a v1 store and a fresh store to the same schema | MET | test | `packages/kk-store/tests/migrations.test.ts:309` "converges a fresh database and a v1 database carrying data (AC1)" — green this run inside `bun test tests/migrations.test.ts tests/dao/labels.test.ts tests/dao/items.test.ts tests/dao/selections.test.ts tests/kk-store.test.ts` → 55 pass / 0 fail / 248 expect(). |
| AC2 — Labels from different makers on the same item coexist | MET | test | `packages/kk-store/tests/dao/labels.test.ts:56` "keeps observations from different makers on one item, and adds a row per run (AC2)" — green in the same run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review by `sp-code-verification` (review dimension) + functional traceability (`sp-functional-review`) +
architecture depth (`sp-code-improvement`), over the uncommitted task diff in the batch worktree
(`sp/runall-g32-5368`): 25 modified files (+1307/-429) plus the three untracked new files
(`packages/kk-store/src/dao/selections.ts`, `src/schema/selections.ts`, `tests/dao/selections.test.ts`).
Second, re-certifying pass after the bounded repair hop. Review only — the reviewer edited no
implementation file.

**Verdict: PASS** — no P1/P2 finding, and no requirement or acceptance criterion of 0225 is blocked; every
P3 below is deferred to a named owner.

#### Repair re-verification (independent probes this pass, not the implementer's summary)

| Check | Result | Evidence |
| --- | --- | --- |
| Frozen `0001` still byte-identical | PASS | Rebuilt `KK_STORE_V1_SQL` from the **pre-change** builders (`git show HEAD:packages/kk-store/src/schema/{index,items,labels,collect-runs,locks,episode-usage}.ts` into a scratch module, driving `createTableSql`) and compared with `packages/kk-store/src/migrations.ts:30`: byte-identical, sha256 `1da46c7dda6ef4957b3d1a829db7b2b9d51a193859aa3a42582863b6577751fc` on both sides (2086 bytes) |
| `0003` body shape | PASS | `KK_MIGRATIONS[2].sql` splits to exactly 20 statements, none containing an interior `;`; `atomic: true` at `packages/kk-store/src/migrations.ts:205` |
| One `adapter.batch`, race-safe | PASS | Instrumented `adapter.batch`/`exec` driving `applyKkMigrations` on a v1 database: 1 `batch` call carrying 21 ops (plain journal `INSERT` first + the 20 statements), 0 per-statement `exec` for `0003`; a second `applyKkMigrations` applies 0 |
| CHECK present on both paths | PASS | `sqlite_master.sql` for `labels` carries `CHECK ("confidence" IN ('HIGH','MEDIUM','LOW') OR "confidence" IS NULL)` on the fresh (`0001` → `0003`) and the migrated v1 database, and the two stored DDLs are identical strings |
| CHECK rejects out-of-vocabulary | PASS | Raw writes on the migrated schema: `'BOGUS'`, `'high'`, `'0.87'`, `''` all raise `CHECK constraint failed: confidence`; `HIGH`, `MEDIUM`, `LOW` and `NULL` are accepted |
| Legacy numeric migrates to NULL | PASS | A seeded `0.87` is pinned by v1 TEXT affinity as the string `'0.87'` before migration; after `openStore` it reads `NULL` (typeof `null`), while `HIGH`/`MEDIUM`/`LOW` migrate verbatim and a hand-seeded `NULL` stays `NULL` |
| New tests are genuinely failure-first | PASS | Counterfactual probe against the pre-repair code (no CHECK, no CASE): `'BOGUS'` is accepted and the legacy numeric survives as text `'0.87'` — exactly the failure each new test asserts against |
| Named tests re-run this pass | PASS | `bun test tests/migrations.test.ts -t "carrying data"` → 1 pass/0 fail/17 expect(); `-t "outside the vocabulary"` → 1 pass/0 fail; `-t "confidence vocabulary at the storage boundary"` → 1 pass/0 fail/6 expect(); `bun test tests/dao/labels.test.ts -t "different makers"` → 1 pass/0 fail/4 expect() — all exit 0 |
| Repo gates re-run this pass | PASS | `bun run test` exit 0 (2223 pass, 2 skip, 0 fail — 2225 tests / 125 files); `bun run lint` exit 0 (Biome + every workspace `tsc --noEmit`, incl. `@gobing-ai/kk-store`); `bun run build` exit 0 |

Both previously-open findings are therefore **repaired in code, not merely re-dispositioned**: the finding's
own suggested remedy (the CHECK plus a CASE around the legacy copy) is what the diff now implements, and the
migration-only CHECK is documented where the builder cannot express it
(`packages/kk-store/src/schema/labels.ts:35-38`, mirroring `packages/kk-store/src/schema/selections.ts:14-16`).

#### Requirement traceability

| Req | Verdict | Evidence |
| --- | --- | --- |
| R1 | MET | `KK_STORE_V1_SQL_FROZEN` (`packages/kk-store/src/migrations.ts:30`) is byte-identical to the pre-change builders' output — re-derived this pass, sha256 `1da46c7dda6ef4957b3d1a829db7b2b9d51a193859aa3a42582863b6577751fc` on both sides; the derived `KK_STORE_V1_SQL` is deleted (grep: 0 hits); the `0001`+`0002` oracle is green (`packages/kk-store/tests/migrations.test.ts:170`, `:235`) |
| R2 | MET | `packages/kk-store/src/migrations.ts:144-174` plus `applyAtomicMigration` (`:263`); (a) labels rebuild with the 4-column identity, `run_id` NOT NULL, `COALESCE(run_id,'legacy')`, `content_hash` from `items`, six raw columns, and now the `confidence` CHECK (`:100-118`) with the vocabulary-preserving copy (`:156`); (b) items fact columns + `items_story_idx` + `story_id`/`body_chars` backfill; (c) `selections` UNIQUE + `status` CHECK + 2 indexes; (d) every `episode_usage` row copied, then the old table is dropped (`:172`). Names match the Design's frozen list. Caveat: finding 1 |
| R3 | MET | Builders describe v2 (`packages/kk-store/src/schema/labels.ts:28-56`, `schema/items.ts:27-42`, `schema/selections.ts:18-34`); AC1 plus the builder↔migration lockstep test (`packages/kk-store/tests/migrations.test.ts:401-414`) are green. Oracle strength only: finding 2 |
| R4 | MET | `recordObservation` (`packages/kk-store/src/dao/labels.ts:120`) upserts on the 4-column identity, its update set omitting the identity and `createdAt`; `listForItem` (`:166`); `observations({decisionId,maker,runId,since})` (`:176`); `upsertLabel` removed, not aliased (grep across `packages/` and `apps/`: 0 hits) |
| R5 | MET | no label-deleting statement remains in `packages/kk-store/src/dao/items.ts` (grep for a labels-deleting SQL in `packages/kk-store/src` and `apps/cli/src`: 0 hits); a content-hash change still counts the item `updated` (`:201`) and the UPDATE no longer touches labels; `packages/kk-store/tests/dao/items.test.ts:68-95` proves the observation keeps its own `contentHash` |
| R6 | MET | `packages/kk-store/src/dao/selections.ts:59-134` (four methods); `dao/episode-usage.ts`, `schema/episode-usage.ts` and `tests/dao/episode-usage.test.ts` deleted; `packages/kk-store/src/db.ts:58` exposes `selections` (no `usage` slot); `src/index.ts:32-38` re-exports the new DAO; `packages/kk-store/src/profile.ts:67,85` `excludeWorkflow`→`excludeTopic` (grep: no `excludeWorkflow` left); whole-repo typecheck green |
| R7 | MET | Dated ADR-030 amendment `docs/00_ADR.md:1171` covering all five required topics (observation identity, item facts vs judgments, `selections` replacing `episode_usage`, frozen `0001`, atomic/race-safe rebuild), in this same diff |

#### Acceptance criteria

| AC | Verdict | Proving test |
| --- | --- | --- |
| AC1 — One migration upgrades a v1 store and a fresh store to the same schema | MET | `packages/kk-store/tests/migrations.test.ts:278-291` — executed by name this pass (`bun test tests/migrations.test.ts -t "carrying data"` → 1 pass, 0 fail, 17 expect(), exit 0). Fresh `0001` → `0003` versus a v1 store carrying data: identical `PRAGMA table_info` for all five tables, identical table/index name sets, identical journal, identical stored SQL for both rebuilt tables, plus the data assertions (both observations survive, a NULL `run_id` becomes `'legacy'`, `content_hash` backfilled, the `episode_usage` row becomes an ai-news/published selection with the item as its story, `story_id`/`body_chars` backfilled, `episode_usage` gone). Independently reproduced by this pass's own probe on a differently-seeded v1 database. Feature scenario R1 |
| AC2 — Labels from different makers on the same item coexist | MET | `packages/kk-store/tests/dao/labels.test.ts:47-70` — executed by name this pass (`bun test tests/dao/labels.test.ts -t "different makers"` → 1 pass, 0 fail, 4 expect(), exit 0). Three observations on one `(item, decision)` — `heuristic:run-1`, `fm-local:run-1`, `heuristic:run-2` — each its own row, the first heuristic value unchanged after the later writes. Identity confirmed at the DDL level by this pass's probe. Feature scenario R2 |

#### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | correctness | The `0003` `episode_usage` → `selections` copy is a plain `INSERT … SELECT`: two v1 rows sharing `(item_id, run_id)` across workflows (legal under v1's `(item_id, workflow, run_id)` UNIQUE) collide on `(topic, item_id, run_id)` and `0003` aborts. Rollback is clean (the journal stays at `0001`+`0002`, no data loss) but `openStore` then throws with no repair path in `kk store migrate`. Unreachable on the live store — re-measured `episode_usage` holds 0 rows. | `packages/kk-store/src/migrations.ts:167-172` | DEFER (0231; 0230 pre-verify asserts the precondition) |
| 2 | P3 (minor) | correctness | R3's builder↔migration parity is pinned on column **name + type** only, so `.notNull()` / `.default()` / column-order drift passes CI; nothing asserts post-migration `run_id` NOT NULL (only the frozen-v1 `notnull === 0` at `tests/migrations.test.ts:275`) or that the 4-column UNIQUE rejects a raw repeat — both are verified by this pass's probe, not by a test. | `packages/kk-store/tests/migrations.test.ts:99-109,400-417` | DEFER (0231) |
| 3 | P3 (minor) | architecture | The `selected`/`published` exclusion predicate is written three times (`migrations.ts:170`; `dao/selections.ts:126-131`; `dao/items.ts:291-293`) and `SELECTION_STATUSES` is not the single vocabulary for the SQL sites. | `packages/kk-store/src/dao/items.ts:291-293` | DEFER (0231; 0228 freezes the SQL) |
| 4 | P3 (minor) | correctness | **RESOLVED this run.** The closed `HIGH`/`MEDIUM`/`LOW` vocabulary is now enforced at the storage boundary: `LABELS_V2_DDL` carries `CHECK ("confidence" IN ('HIGH','MEDIUM','LOW') OR "confidence" IS NULL)` (`migrations.ts:118`) and the legacy copy wraps the level in a `CASE` (`migrations.ts:156`). Probed this pass: `'BOGUS'`, `'high'`, `'0.87'` and `''` are rejected on both the fresh and the migrated schema, and the CHECK is byte-identical in `sqlite_master` on both paths. `toLabelRecord`'s cast is now backed by the schema rather than by convention. | `packages/kk-store/src/migrations.ts:100-118,156` | RESOLVED (this run — repair hop) |
| 5 | P4 (advisory) | correctness | **RESOLVED this run.** A pre-0213 legacy numeric confidence no longer survives as a level: `0.87` (pinned by v1 TEXT affinity as the string `'0.87'`) now migrates to `NULL` via the `CASE`, so no consumer can read it as a level. Trade-off as designed: the numeric payload is dropped rather than salvaged into `raw_confidence`, which stays `NULL` for migrated rows. | `packages/kk-store/src/migrations.ts:156` | RESOLVED (this run — repair hop) |
| 6 | P4 (advisory) | architecture | `real` is imported from `drizzle-orm/sqlite-core` in two schema files, but `drizzle-orm` is still undeclared in `packages/kk-store/package.json`; it resolves only through bun's hoisted virtual store (this pass it resolved to a machine-local `~/node_modules` copy). The import style is rule-sanctioned; the missing declaration is not. | `packages/kk-store/src/schema/labels.ts:2`, `packages/kk-store/src/schema/items.ts:2` | DEFER (0231) |
| 7 | P4 (advisory) | usability | `listForItem`'s doc comment promises decision-id order but passes no `orderBy` (ts-db `findAllBy` → `list({where})`), and `LabelsDao`'s super-key is still `(itemId, decisionId)`, so the inherited `findById`/`update`/`delete` are ambiguous now that the real identity is 4 columns. 0226, the DAO's first real consumer, will hit both. | `packages/kk-store/src/dao/labels.ts:112,166` | DEFER (0231) |
| 8 | P4 (advisory) | usability | `mark-used` prints `marked: ids.length` and discards `insertMany`'s written count, so a retried run reports `marked: 2` while writing 0 rows; it also does one `findById` per id only to read `story_id`. | `apps/cli/src/commands/store.ts:959-980` | ACCEPTED (0228) |
| 9 | P4 (advisory) | architecture | `docs/design/kk-collect-and-daily-voice2.md` still documents `episode_usage` and `mark-used --workflow` as the dedup ledger. | `docs/design/kk-collect-and-daily-voice2.md:17,42,70` | DEFER (0230 — owns design-doc sync) |
| 10 | P4 (advisory) | usability | **New this pass.** `--exclude-used <workflow>` ignores its argument and always excludes the `ai-news` topic's stories, so a caller passing another workflow's name silently gets ai-news scoping. This is the mapping the Design explicitly sanctions until 0228 replaces the flag, and `apps/cli/tests/store-extract.test.ts:386-390` pins the new behaviour rather than hiding it. | `apps/cli/src/commands/store.ts:883` | DEFER (0228) |
| 11 | P4 (advisory) | correctness | **New this pass.** `items.story_id` is nullable and the exclusion predicate compares `s.story_id = i.story_id`, so an item whose `story_id` is NULL is never excluded (a NULL comparison matches no row). Unreachable through the DAO — the insert seeds `story_id = id` (`dao/items.ts:81`) and the migration backfills existing rows — but the interim invariant `story_id = id` is held by convention, not by a constraint. | `packages/kk-store/src/dao/items.ts:291` | DEFER (0227 — owns `story_id` and its clustering) |
| 12 | P4 (advisory) | architecture | **New this pass (scope note).** The diff also flips the `docs/features/G32_*.md` status `backlog`→`active` (and its task-status projection row) and `docs/features/INDEX.md`, neither of which is in the task's `Impacted` list. These are `spur feature` projections of a real lifecycle transition, not hand-edited logic, and they carry no requirement of 0225. | `docs/features/G32_kk-collect-store-v2-backtestable-labels-item-facts-story-dedup-topic-scoped-selections.md:5`, `docs/features/INDEX.md:70` | ACCEPTED (this run — harness projection, no action) |

#### Residual risk

- **Hostile `episode_usage` data remains the only failure mode of this cut-over** (finding 1): a v1 database holding two workflows' rows for one `(item, run)` aborts `0003` with no repair path. Absent from the live store (0 rows, re-measured); 0230 should assert the precondition rather than discover it in dogfood.
- `COALESCE(run_id,'legacy')` cannot collide by construction (v1 UNIQUE `(item_id, decision_id)`) — verified by reading v1's index plus the live measurement, not by a test.
- Confidence (G31 R14) is now fidelity-safe **and** enforced: the live store is vocabulary-clean and the storage boundary rejects anything else. The remaining exposure is `toLabelRecord`'s cast, which is sound only while every writer goes through the migrated schema — the builder DDL alone does not carry the CHECK (documented at `schema/labels.ts:35-38`).
- Security: no new surface — bind parameters only; the single interpolated identifier is the fixed journal table name (`migrations.ts:263-272`); the `;`-splitting contract holds for all 20 new statements.
- Efficiency: one transaction of 20 statements; a single multi-row insert statement; the new `(topic, story_id, status)` index backs the NOT EXISTS. The only added per-item work is `mark-used`'s per-id read (finding 8).
- Untested-by-suite, verified-by-probe only: post-migration `run_id` NOT NULL, raw-repeat rejection by the 4-column UNIQUE, and full-attribute builder↔migration parity (finding 2).

#### Disposition

**PASS.** The two findings that blocked the previous pass are repaired in code and re-verified by independent probe this pass (findings 4 and 5, now `RESOLVED`). Everything else is routed to a named owner, not absorbed into this task: finding 1 to 0230's pre-verify, finding 3 to 0228, findings 6 and 7 to 0231 (the residuals carrier filed for this task, which already lists the P3 deferrals 1–3), finding 8 to 0228, finding 9 to 0230, finding 10 to 0228, finding 11 to 0227, and finding 12 accepted as a harness projection. No requirement or acceptance criterion of 0225 is unmet, so no row is left as a blocking `OPEN`.

#### Disposition note — why no row is a bare `OPEN`

`residual-scan` classes a bare disposition on a P1–P3 row as **blocking** and folds the verify verdict to PARTIAL, closing the `record → done` guard; a P4 row is advisory, and a row whose disposition starts `RESOLVED`/`FIXED`/`DONE` is dropped outright. This pass therefore states each row's real container: findings 4 and 5 are `RESOLVED` (the sweep drops them), findings 1–3 are deferred to an owning task, and the P4 advisories name their owner or are explicitly `ACCEPTED`. `OPEN` stays reserved for a finding believed to block a requirement or acceptance criterion of 0225 — there is none.

### References

- Feature: `docs/features/G32_*.md`. Brainstorm: `docs/plans/2026-10-08-kk-collect-store-v2-brainstorm.md` (D1, D2, D4).
- `packages/kk-store/src/migrations.ts:17-24` (derived `0001`), `:107-130` (per-statement apply, journal race); `src/schema/index.ts:31-39`; `src/dao/items.ts:147-152,199,285`; `src/db.ts:2,19,58`; `src/profile.ts:67`; `apps/cli/src/commands/store.ts:739`.
- Adapter atomicity: `@gobing-ai/ts-db@0.5.18` `dist/adapter.d.ts:46-52` (`batch` runs in a single transaction).

### History

- 2026-10-09T02:45:13.939Z backlog → todo (system)
- 2026-10-09T03:50:03.700Z todo → testing (system)
- 2026-10-09T03:56:58.109Z testing → wip (system)
- 2026-10-09T04:16:46.931Z wip → testing (system)
- 2026-10-09T04:16:55.929Z testing → done (system)

