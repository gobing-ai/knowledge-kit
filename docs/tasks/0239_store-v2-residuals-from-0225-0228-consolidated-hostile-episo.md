---
schema_version: 1
name: "Store-v2 residuals from 0225-0228 (consolidated): hostile episode_usage copy, weak parity test, duplicate exclusion rule, migrated model-row gate, mixed-script tokenizer"
status: done
template: standard
created_at: 2026-10-09T17:29:15.319Z
updated_at: "2026-10-09T19:35:38.345Z"
feature_id: G32

priority: P1
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0239-verdict.json
---

## 0239. Store-v2 residuals from 0225-0228 (consolidated): hostile episode_usage copy, weak parity test, duplicate exclusion rule, migrated model-row gate, mixed-script tokenizer

### Background

Consolidates five fragmentary residual files that the G32 batch's `residual-scan settle` wrote during tasks 0225–0228:
`0231_residuals-from-0225.md`, `0232_residuals-from-0225.md`, `0233_residuals-from-0226.md`,
`0234_residuals-from-0227.md`, `0235_residuals-from-0228.md`. All five are removed by this task's filing.

Why they were merged:

- **They are fragments, not separable work.** 0231 and 0232 are near-duplicates of the same three 0225
  findings (0231 also carries the `labels.confidence` CHECK finding, which was **resolved inside the 0225
  run** — the CHECK and its `CASE` copy are in `packages/kk-store/src/migrations.ts:118,156` — so only the
  three live findings are carried here).
- **One of them collided on its WBS.** The batch ran in a worktree while another session allocated ids
  0235–0237 on `main`; `0235`, `0236` and `0237` each name two different tasks now, and `spur task show
  0235` resolves to the other session's `The 上传图文 note pairs each generated image with its text`.
- **They shared one surface.** Every finding below is in the `@gobing-ai/kk-store` store-v2 code (0225–0228's
  surface), so one owner can read them together and verify them with one gate run.

Each requirement below preserves the finding's original evidence (its `file:line`, the probe result, and the
`review-finding:` id it was filed under), and the fix direction the reviewer gave. Nothing is dropped; the
CONFIDENCE-CHECK item is recorded as already resolved rather than re-opened.

### Requirements

> Re-verified on 2026-10-09 against `main` at `4a7db505`. All five issues still reproduce. Anchors below are current; R2's and R4's framing is corrected.

- [x] R1. **Hostile `episode_usage` data aborts `0003`.** The copy at `packages/kk-store/src/migrations.ts:178-182` is a plain `INSERT … SELECT … FROM episode_usage`.
  - Two v1 rows can share `(item_id, run_id)` across workflows: that is legal under v1's `(item_id, workflow, run_id)` UNIQUE. They collide on `selections (topic, item_id, run_id)`, so `0003` fails and `openStore` throws on every call.
  - Make the copy collision-safe and deterministic. **This must land before `0003` ships in a release** (0.0.33 does not carry it; `KK_MIGRATIONS` is append-only once released).
  - The live store is already journaled at `0003` and is unaffected.
  - `review-finding:957489fb`, `review-finding:712e6fa0`.
- [x] R2. **The builder↔DDL parity oracle is weak.** The fresh-vs-migrated comparison (`packages/kk-store/tests/migrations.test.ts:282`) already compares full `PRAGMA table_info`. The weak one is `keeps the v2 builders and the migrated DDL in lockstep` (`:468-482`): `declaredColumns` (`:106`) extracts only `(name, type)`, and the test sorts by name.
  - Make it compare `notnull`, `dflt_value` and DDL order.
  - Add one test asserting that a raw repeat of `(item_id, decision_id, maker, run_id)` is rejected by `labels_observation_unique`.
  - CHECK rejection is already covered by `:426` (selections status) and `:442` (labels confidence), so no new CHECK test is needed.
  - `review-finding:fa5ba5fb`, `review-finding:0c8c1ffc`.
- [x] R3. **Delete the dead accessor.** `SelectionsDao.excludedStories` (`packages/kk-store/src/dao/selections.ts:143-150`) has no production caller. The only production exclusion predicate is `ItemsDao` (`packages/kk-store/src/dao/items.ts:438-443`), and `0003`'s copy writes the `'published'` literal. Delete:
  - the accessor and its doc reference (`dao/selections.ts:45`);
  - its unit test (`tests/dao/selections.test.ts:91-93`, plus header item 4 at `:10`);
  - its use in `tests/kk-store.test.ts:249` (header item 17 at `:43`). Re-assert that the exclusion holds through `ItemsDao`'s profile extract: the selected story no longer appears.

  With a single predicate site left, no shared SQL fragment is needed. `review-finding:be1640f8`, `review-finding:a89c083a`, `review-finding:2f4d5156`.
- [x] R4. **State, test and keep the rule that a migrated `source 'model'` row is not current.** The gate is `packages/kk-store/src/dao/labels.ts:145`, `(l.source <> 'model' OR l.raw_confidence >= ?)`. `0003` copies v1 rows with `raw_*` and `catalog_version` NULL, so they fail it. Decision (see Q&A): **no gate change**.
  - Add a test pinning that a migrated v1 model row is not current, while a migrated heuristic row at the same hash is.
  - Add a test pinning that a **new** model row with NULL `raw_confidence` is not current.
  - State both rules in `docs/04_DESIGN.md` (label surface) and in `docs/design/kk-collect-and-daily-voice2.md` §4.
  - Recovery for legacy items is a relabel (0242 R3). `review-finding:e7189224`.
- [x] R5. **Mixed-script titles never cluster.** `TOKEN_RUN` (`packages/kk-store/src/story.ts:50`) word alternative `[\p{L}\p{N}]+` also matches Han and kana. As a result, `storyTokens("OpenAI发布新模型")` = `["openai发布新模型"]` (reproduced 2026-10-09). Exclude the CJK scripts from the word class, and add fixtures in both directions. Live impact is nil today. `review-finding:ca5d010f`.

### Acceptance Criteria

- [x] AC1 — A v1 store whose `episode_usage` holds two rows sharing `(item_id, run_id)` under different workflows migrates to `0003` cleanly, keeping exactly one `selections` row for that pair: the earliest `used_at`, ties broken by `workflow` (req: R1).
- [x] AC2 — The builder-parity test fails when a builder's `.notNull()`, `.default()` or column order drifts from the DDL, and a raw repeat of the 4-column label identity is rejected by a test (req: R2).
- [x] AC3 — `excludedStories` no longer exists (`rg excludedStories packages apps` → nothing), and the selected-story exclusion is still asserted through `ItemsDao` (req: R3).
- [x] AC4 — Tests pin that a migrated v1 `source 'model'` row and a new model row with NULL `raw_confidence` are both non-current, and `docs/04_DESIGN.md` states the rule (req: R4).
- [x] AC5 — `storyTokens` splits `OpenAI发布新模型`, `GPT5震撼发布` and `Meta裁员1000人` at the script boundary, and a whitespace-only near-duplicate of each shares one `story_id` (req: R5).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09 refine

- **Q: R4, admit legacy model rows or keep them out?** Keep them out, with no gate change. The old `'legacy'` run-id discriminator is wrong (only NULL v1 run_ids became `'legacy'`). The rows lack evidence, and every legacy item needs a relabel for the judgment decisions anyway (0242 R3).
- **Q: R1, a tie-break or a loud failure?** A tie-break with `ON CONFLICT DO NOTHING` over an ordered source. It is one statement, it is deterministic, and it needs no repair path.
- **Q: Is R1 safe to edit given that `KK_MIGRATIONS` is append-only?** Only while `0003` is unreleased (0.0.33 does not contain it). So this task blocks the 0242 release.
- **Q: R2, are CHECK rejection tests missing?** No. `migrations.test.ts:426,442` already cover them. Only the UNIQUE repeat and the builder-parity attributes are missing.
- **Q: R3, consolidate into a shared fragment?** No. After the deletion, one predicate site remains.

### Design

- **R1: `ON CONFLICT DO NOTHING` with an ordered source.**
  ```sql
  INSERT INTO selections (…same columns…)
  SELECT 'ai-news', "item_id", "run_id", "item_id", "workflow", NULL, NULL, 'published', "used_at", "used_at", "created_at", "updated_at"
  FROM episode_usage WHERE true ORDER BY "used_at", "workflow"
  ON CONFLICT("topic", "item_id", "run_id") DO NOTHING
  ```
  - `WHERE true` is required: SQLite's upsert-after-SELECT parse ambiguity (sqlite.org/lang_upsert.html, "Parsing Ambiguity").
  - The insert order makes the survivor deterministic: earliest `used_at`, then `workflow`.
  - It is one `;`-free statement, so the single-`adapter.batch` atomicity (`migrations.ts:254-272`) holds.
  - Editing `0003`'s SQL in place is legal only because `0003` is unreleased. Fresh and test stores run the new SQL; the live store already journaled `0003` and never re-runs it.
  - Test: a v1 fixture with two colliding rows → `openStore` succeeds, and there is one `selections` row with the expected `workflow`.
- **R2: tighten `declaredColumns`, keep the primary oracle.**
  - Parse `NOT NULL` and `DEFAULT <expr>` from each column line of `createTableSql`.
  - Map them to `{name, type, notnull, dflt_value}` to match `liveColumns`, and drop the `.sort(...)`, so order is asserted too.
  - Prove the new oracle by mutation: locally flip one builder's `.notNull()`, watch the test fail, then revert. Note this in Testing.
  - UNIQUE test: insert one label row through the DAO, then a raw `INSERT` with the same 4-tuple → expect `UNIQUE constraint failed`.
- **R3: delete, don't consolidate.** Only one production predicate site remains (`items.ts:438-443`). The `0003` copy writes a status literal, not an exclusion predicate. A shared fragment would be an abstraction with one caller.
- **R4: keep legacy model rows ineligible.**
  - The earlier design (admit a NULL confidence on rows whose `run_id` is `'legacy'`) does not work. `0003` only maps a **NULL** v1 `run_id` to `'legacy'` (`COALESCE(l.run_id, 'legacy')`), and live v1 rows carry real run ids, so `'legacy'` does not identify migrated rows. The real discriminator would be `catalog_version IS NULL`.
  - Admitting them buys nothing. On the live store they are 9 rows, and every legacy item lacks the three judgment decisions, so it must be relabelled anyway (0242 R3). A relabel supersedes these rows.
  - Keeping evidence-less model answers out of the current set is the same principle as the `min_confidence` gate.
- **R5: subtract the CJK scripts from the word class with the `v` flag.**
  ```ts
  const TOKEN_RUN =
      /(?<cjk>[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+)|(?<word>[[\p{L}\p{N}]--[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]]+)/gv;
  ```
  - Verified under Bun 1.3.14: `"OpenAI发布新模型 Meta裁员1000人"` → `OpenAI`, `发布新模型`, `Meta`, `裁员`, `1000`, `人`.
  - The `v` flag is ES2024. Bun supports it, and the shared tsconfig targets `ESNext` (`tooling/typescript`), so the literal typechecks.

### Plan

1. R1: write the colliding-`episode_usage` v1 fixture test in `packages/kk-store/tests/migrations.test.ts` (fails today), then change the `0003` copy SQL.
2. R2: extend `declaredColumns` with notnull and default, drop the sort, add the 4-tuple UNIQUE rejection test, and do the mutation check (flip `.notNull()`, see the failure, revert).
3. R3: delete `excludedStories`, the doc line `selections.ts:45`, and the tests at `tests/dao/selections.test.ts:91-93` / `tests/kk-store.test.ts:249`. Re-assert the exclusion via the `ItemsDao` extract path, and update the header failure lists.
4. R4: add the two non-current tests (migrated model row; new model row with NULL confidence). Write the rule into `docs/04_DESIGN.md` and design §4.
5. R5: add the mixed-script fixtures to the story tests (fail today), then swap in the `v`-flag `TOKEN_RUN`.
6. Run `bun run gate` and `spur task check 0239`. This task must merge before the 0242 release, because R1 edits `0003`.

### Solution

#### Change map

- `packages/kk-store/src/migrations.ts:182-183`: `0003_store_v2` migration's `episode_usage` copy adds `WHERE true ORDER BY "used_at", "workflow" ON CONFLICT("topic", "item_id", "run_id") DO NOTHING` so colliding rows resolve deterministically to earliest `used_at` (R1, AC1).
- `packages/kk-store/src/schema/items.ts:29-32`: placed `...standardColumns` before `engagement` so builder column order matches DDL and SQLite PRAGMA table_info (R2, AC2).
- `packages/kk-store/src/dao/selections.ts:40-48`: `SelectionsDao` class doc updated; dead `excludedStories` accessor removed from the class (R3, AC3).
- `packages/kk-store/tests/dao/selections.test.ts` & `tests/kk-store.test.ts`: removed `excludedStories` references, asserting exclusion via `ItemsDao.selectByProfile` (R3, AC3).
- `docs/04_DESIGN.md:567-570` & `docs/design/kk-collect-and-daily-voice2.md:121-124`: stated rule that migrated v1 model rows and new model rows with NULL `raw_confidence` are non-current (R4, AC4).
- `packages/kk-store/src/story.ts:50`: `TOKEN_RUN` regex uses `v` flag subtracting CJK scripts from word class (R5, AC5).
- `packages/kk-store/tests/migrations.test.ts`: added colliding `episode_usage` test, tightened `declaredColumns`/`liveColumns` to check `notnull`, `dflt_value` and DDL order, added `labels_observation_unique` duplicate rejection test (R1, R2).
- `packages/kk-store/tests/dao/labels.test.ts`: added test pinning non-currency of model rows with NULL `raw_confidence` (R4).
- `packages/kk-store/tests/story.test.ts`: added tests for mixed-script title tokenization and clustering (R5).

### Testing

- `bun test packages/kk-store/tests/migrations.test.ts`: 12 pass, 0 fail (includes mutation check)
- `bun test packages/kk-store/tests/dao/selections.test.ts packages/kk-store/tests/kk-store.test.ts`: 11 pass, 0 fail
- `bun test packages/kk-store/tests/dao/labels.test.ts`: 15 pass, 0 fail
- `bun test packages/kk-store/tests/story.test.ts`: 17 pass, 0 fail
- `bun run gate`: clean (format, build, lint, typecheck, recommended-pre-check 51 rules, 2341 tests pass, recommended-post-check 2 rules)
- `spur task check 0239`: PASS (0 findings)

### Review

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 | hygiene | Five residual files consolidated and closed cleanly | packages/kk-store | RESOLVED |

#### Review Report — 0239 (2026-10-09)

**Scope:** Store-v2 residuals consolidated from 0225-0228: collision-safe 0003 episode_usage copy (R1), builder-DDL parity oracle (R2), dead excludedStories deletion (R3), legacy model row gate test and doc state (R4), mixed-script regex tokenizer (R5).
**Verdict:** PASS
**Confidence:** HIGH — every requirement was re-verified against the merged tree at line level, and the two behavioural claims were proven to fail without the fix. R1: `packages/kk-store/src/migrations.ts:183` (the `WHERE true ORDER BY … ON CONFLICT … DO NOTHING` copy), with its colliding-fixture test at `packages/kk-store/tests/migrations.test.ts:488`. R2: the widened oracle at `packages/kk-store/tests/migrations.test.ts:515` (notnull/dflt_value/DDL order) and `:530` (the 4-column UNIQUE repeat); the oracle was proven sensitive by mutation — flipping `.notNull()` on `labels.labeled_at` in `packages/kk-store/src/schema/labels.ts` made the test fail, and the flip was reverted. R3: `rg excludedStories packages apps` returns zero source hits, and the exclusion is re-asserted through the single surviving predicate at `packages/kk-store/src/dao/items.ts:441` via `packages/kk-store/tests/kk-store.test.ts:249`. R4: `packages/kk-store/tests/dao/labels.test.ts:489`, with the rule stated at `docs/04_DESIGN.md:567-570` and `docs/design/kk-collect-and-daily-voice2.md:121-124`. R5: `packages/kk-store/src/story.ts:51`, with both directions fixtured at `packages/kk-store/tests/story.test.ts:48` and `:114`. No claim here rests on unverified recollection.

##### Per-requirement results

| Req | Verdict | Evidence |
|-----|---------|----------|
| R1 | MET | `packages/kk-store/src/migrations.ts:182-183` adds `WHERE true ORDER BY "used_at", "workflow" ON CONFLICT("topic", "item_id", "run_id") DO NOTHING`; tested in `packages/kk-store/tests/migrations.test.ts:488`. |
| R2 | MET | `declaredColumns` and `liveColumns` compare `notnull`, `dflt_value` and exact DDL order; mutation test proved sensitivity; `labels_observation_unique` raw repeat tested. |
| R3 | MET | `excludedStories` deleted (`rg excludedStories packages apps` -> 0 occurrences in source); tested via `ItemsDao.selectByProfile`. |
| R4 | MET | `packages/kk-store/tests/dao/labels.test.ts:489` asserts non-currency of legacy model rows and new model rows with NULL `raw_confidence`; rules documented in `docs/04_DESIGN.md` and `docs/design/kk-collect-and-daily-voice2.md`. |
| R5 | MET | `packages/kk-store/src/story.ts:50` uses `v` flag subtraction; tested on `OpenAI发布新模型`, `GPT5震撼发布`, `Meta裁员1000人` in `packages/kk-store/tests/story.test.ts:48,114`. |

##### Per-AC results

| AC | Verdict | Evidence |
|----|---------|----------|
| AC1 | MET | `packages/kk-store/tests/migrations.test.ts:488` |
| AC2 | MET | `packages/kk-store/tests/migrations.test.ts:515,530` |
| AC3 | MET | `rg excludedStories packages apps` clean |
| AC4 | MET | `packages/kk-store/tests/dao/labels.test.ts:489`, `docs/04_DESIGN.md:567` |
| AC5 | MET | `packages/kk-store/tests/story.test.ts:48,114` |

### References

- Source tasks: `docs/tasks/0225_*.md` (R2/R3 here), `docs/tasks/0226_*.md` (R4), `docs/tasks/0227_*.md` (R5), `docs/tasks/0228_*.md` (R3's accessor).
- Consolidated from: `docs/tasks/0231_residuals-from-0225.md`, `0232_residuals-from-0225.md`, `0233_residuals-from-0226.md`, `0234_residuals-from-0227.md`, `0235_residuals-from-0228.md` (all removed by this filing).
- Already resolved in-batch, recorded for completeness: the `labels.confidence` CHECK
  (`packages/kk-store/src/migrations.ts:118`) with the legacy copy's `CASE` (`:156`) — 0225's finding 4.
- Feature: G32. Live-store measurements in R2/R4/R5 come from the batch's dogfood copies, not from the operator's store.

### History

- 2026-10-09T17:30:52.755Z backlog → todo (system)
- 2026-10-09T18:16:59.639Z todo → wip (system)
- 2026-10-09T18:31:18.643Z wip → testing (system)
- 2026-10-09T18:31:55.088Z testing → done (system)

