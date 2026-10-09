---
schema_version: 1
name: "Store-v2 residuals from 0225-0228 (consolidated): hostile episode_usage copy, weak parity test, duplicate exclusion rule, migrated model-row gate, mixed-script tokenizer"
status: todo
template: standard
created_at: 2026-10-09T17:29:15.319Z
updated_at: "2026-10-09T17:30:52.755Z"
feature_id: G32

priority: P1
ac_altitude: task-local
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

- [ ] R1. **Hostile `episode_usage` data aborts `0003` with no repair path.** `packages/kk-store/src/migrations.ts:167`
  (the `0003` `episode_usage` → `selections` copy) is a plain `INSERT … SELECT`: two v1 rows sharing
  `(item_id, run_id)` across different workflows are legal under v1's `(item_id, workflow, run_id)` UNIQUE but
  collide on `selections`' `(topic, item_id, run_id)`, so `0003` raises `UNIQUE constraint failed:
  selections.topic, selections.item_id, selections.run_id`. The rollback is clean (journal stays `0001`+`0002`,
  no data loss) but `openStore` then throws on every subsequent call and `kk store migrate` offers no repair
  path. Unreachable on the live store (0 rows, measured twice). Either make the copy collision-safe
  (deterministic tie-break on `workflow`/`rank`) or fail with an actionable message naming the offending rows.
  `review-finding:957489fb`, `review-finding:712e6fa0`.
- [ ] R2. **The builder↔migration parity test is too weak.** `packages/kk-store/tests/migrations.test.ts:99-109,400-417`
  compares column **name + type** only (AC1 sorts columns), so `.notNull()`, `.default()` and column-order drift
  pass CI, and nothing asserts that post-migration `run_id` is NOT NULL or that the 4-column UNIQUE rejects a
  raw repeat — both were verified by probe, not by a test. Assert the full column attribute set and the two
  migration-only constraints (the composite UNIQUE and the CHECK).
  `review-finding:fa5ba5fb`, `review-finding:0c8c1ffc`.
- [ ] R3. **One home for the selected/published exclusion rule.** The predicate is written three times
  (`packages/kk-store/src/migrations.ts:170`; `packages/kk-store/src/dao/selections.ts:126-131`;
  `packages/kk-store/src/dao/items.ts:291-293`) and `SELECTION_STATUSES` is not the single vocabulary for the SQL
  sites. Related: `SelectionsDao.excludedStories` (`packages/kk-store/src/dao/selections.ts:143`, duplicate rule at
  `dao/items.ts:441`) has **no production caller** — only `packages/kk-store/tests/dao/selections.test.ts:91` —
  and is the only uncovered code in the 0228 run (`dao/selections.ts` 93.33% lines / 81.82% funcs). Either delete
  the accessor or route the R4 `NOT EXISTS` through it, so the rule has one home.
  `review-finding:be1640f8`, `review-finding:a89c083a`, `review-finding:2f4d5156`.
- [ ] R4. **A migrated `source 'model'` row can never be current.** `packages/kk-store/src/dao/labels.ts:145`
  gates model rows on `raw_confidence >= minConfidence`, but every pre-v2 row is copied with the raw columns as
  literal `NULL`s while `content_hash` is backfilled (`packages/kk-store/src/migrations.ts:153-159`), and
  `NULL >= 0.8` is not true. Measured on a copy of the live store (68 items / 340 labels): 340/340 keep a
  `content_hash`, yet only **320 are current** — the 20 exceptions are exactly the 12 `source 'model'` rows plus
  the 8 `source 'default'` rows the rule refuses by design. Those `(item, decision)` pairs then have no current
  label, so a `where` predicate on that decision excludes the item (`dao/items.ts:252`) and only new/edited ids
  are re-labelled. The same gate also refuses a **new** row when spur answers `source 'model'` with no numeric
  confidence — coherent with `labelConfidence('model', null) === 'LOW'` but nowhere stated. Decide and encode the
  semantics (backfill a legacy `raw_confidence`, or treat an absent confidence as eligible), then test it; state
  the rule in `docs/04_DESIGN.md` either way. `review-finding:e7189224`.
- [ ] R5. **Mixed-script titles never cluster.** `packages/kk-store/src/story.ts:44` (`TOKEN_RUN`) — the word
  alternative `[\p{L}\p{N}]+` also matches Han/kana, so a CJK run immediately after a Latin/digit character is
  absorbed into ONE fused token instead of being bigrammed. Measured with the shipped function:
  `storyTokens("OpenAI发布新模型")` = `{"openai发布新模型"}`, `storyTokens("GPT5震撼发布")` = `{"gpt5震撼发布"}`,
  `storyTokens("Meta裁员1000人")` = `{"meta裁员1000人"}` (one token each), so
  `jaccard("OpenAI发布新模型","OpenAI 发布新模型") = 0.00` and a whitespace-only near-duplicate never shares a
  story at any threshold. Live impact is nil today (0 of 78 live titles are mixed-script). Stop the word
  alternative before Han/Hiragana/Katakana, or split the normalized title into script runs before tokenizing, and
  add the mixed-script fixtures. `review-finding:ca5d010f`.

### Acceptance Criteria

- [ ] AC1 — A v1 store whose `episode_usage` holds two rows sharing `(item_id, run_id)` across workflows either migrates cleanly or fails with an actionable message, and never leaves `openStore` throwing with no repair path.
- [ ] AC2 — The builder↔migration parity test fails on a `.notNull()`/`default`/column-order change, on a dropped 4-column UNIQUE, and on a dropped CHECK.
- [ ] AC3 — The selected/published exclusion rule has exactly one definition, and no DAO accessor is kept alive only by its own tests.
- [ ] AC4 — A migrated `source 'model'` observation is current when the chosen semantics say it should be, asserted by a test on a data-carrying v1 store; the rule is stated in `docs/04_DESIGN.md`.
- [ ] AC5 — A whitespace-only near-duplicate of a mixed-script title shares one `story_id`, asserted by fixtures for both scripts.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Each requirement is a self-contained fix on the store-v2 surface, in dependency order; one agent can land them
together and verify with one `bun run gate`.

- **R1 — make the copy deterministic.** Prefer the tie-break over the loud failure: order the `0003`
  copy's source rows (`ORDER BY item_id, run_id, workflow`) so the first row per `(item_id, run_id)` wins
  and every later collision is dropped, keeping `rank` from the surviving row. The `;`-free statement
  constraint and the single-`adapter.batch` atomicity (`packages/kk-store/src/migrations.ts:195`) must hold.
  If a tie-break cannot be expressed without a `;`, fail with the offending `(item_id, run_id)` ids in the
  message instead of the bare SQLite error.
- **R2 — tighten the oracle, not the builders.** Extend `tableColumns()` to compare `notnull`, `dflt_value`
  and ordinal position, then add the two migration-only assertions (a raw repeat of the 4-column identity is
  rejected; a non-vocabulary `confidence` is rejected). Keep the fresh-vs-migrated comparison as the
  primary oracle — the new assertions must not replace it.
- **R3 — one definition.** Keep the predicate in `ItemsDao.selectByProfile` (it is the query planner's home and
  the only production path) and delete `SelectionsDao.excludedStories` with its test, rather than routing the
  `NOT EXISTS` through the accessor: the accessor exists for a caller that never arrived, and deleting it
  removes the uncovered code. Replace the duplicated SQL literals with one exported vocabulary
  (`SELECTION_STATUSES` / a shared `selectedOrPublishedSql()` fragment) used by both remaining sites.
- **R4 — encode the semantics explicitly.** Backfill `raw_confidence` during the `0003` copy is not possible
  from `labels` alone (the value was dropped pre-0225), so treat an absent confidence on a **migrated** row as
  eligible: gate on `(l.raw_confidence IS NULL OR l.raw_confidence >= ?)` for `source 'model'`, and keep the
  existing `labelConfidence` mapping untouched. A **new** model answer with no numeric confidence stays
  ineligible (it carries a real `NULL`, and its level is `LOW` by design) — the distinction between migrated
  and new rows is the run's `legacy` marker on `run_id`.
- **R5 — stop the word alternative at the script boundary.** Exclude Han/Hiragana/Katakana (and the CJK
  extensions) from the Latin/digit word class in `TOKEN_RUN`, so `OpenAI发布新模型` tokenizes as the Latin
  word plus CJK bigrams. Add fixtures for both directions (Latin-then-CJK and CJK-then-Latin/digit) and keep
  the existing unicode-agnostic tests green.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Source tasks: `docs/tasks/0225_*.md` (R2/R3 here), `docs/tasks/0226_*.md` (R4), `docs/tasks/0227_*.md` (R5), `docs/tasks/0228_*.md` (R3's accessor).
- Consolidated from: `docs/tasks/0231_residuals-from-0225.md`, `0232_residuals-from-0225.md`, `0233_residuals-from-0226.md`, `0234_residuals-from-0227.md`, `0235_residuals-from-0228.md` (all removed by this filing).
- Already resolved in-batch, recorded for completeness: the `labels.confidence` CHECK
  (`packages/kk-store/src/migrations.ts:118`) with the legacy copy's `CASE` (`:156`) — 0225's finding 4.
- Feature: G32. Live-store measurements in R2/R4/R5 come from the batch's dogfood copies, not from the operator's store.

### History

- 2026-10-09T17:30:52.755Z backlog → todo (system)

