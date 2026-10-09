---
schema_version: 1
name: "Topic-scoped selections: kk store select, mark-published, release; story exclusion; voice2 select node"
status: done
template: feature-impl
created_at: 2026-10-09T01:27:20.108Z
updated_at: "2026-10-09T21:38:55.916Z"
feature_id: G32

dependencies: ["0225", "0227"]
priority: P1
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0228-verdict.json
---

## 0228. Topic-scoped selections: kk store select, mark-published, release; story exclusion; voice2 select node

### Background

Root cause of "yesterday's episode = the day before's": `mark-used` is the tail of the voice2 DAG (`plugins/kk/workflows/kk-daily-ai-voice2.yaml:643-660`, after `publish-classify`). Any run that fails, pauses at review, or skips publish records nothing. The live store has `episode_usage` rows from exactly one run. Usage is also keyed by workflow, while one item may serve several topics (ai-news today, more later), and it has no story-level dedup.

Depends on 0225 (the `selections` table) and 0227 (`story_id`).

**Refine corrections (2026-10-08)**

- `mark-used` is at `kk-daily-ai-voice2.yaml:610-626`, not `:643-660`. It depends on `[publish-classify, extract]`, and `run-report` (`:628`) depends on `mark-used`. Live `episode_usage` now holds **0** rows (it held one run's rows at brainstorm time).
- **Selection point corrected.** `21-plan/<date>_03_plan_plan.json` is written by `plan` (`dailyPlan`, `plugins/kk/scripts/daily-stages.ts:576-598`) as the pre-QC plan. `qc-content` then filters by category and score and applies the topic boundary (`daily-stages.ts:112-185`), and `plan-translate` overwrites the plan file with the QC'd candidates. Selecting the pre-QC plan would exclude items the run rejected and never used. `select` therefore runs after `qc-content` and reads `21-plan/<date>_04_quality-control-content_candidates.json` (a Content whose `metadata.docs` is a Doc[]), the same shape `pool-count` already reads (`store.ts:896-911`).
- **R7 simplified.** A failed run cannot be detected without reading spur traces. It is unnecessary anyway: once `mark-published` promotes a run's rows, any **other** run still holding `selected` rows did not publish. `prepare` runs before this run's `select`, so it never sees its own rows.
- `reason`: episode-plan-gen emits no per-item rationale, so `select` writes NULL. The column is reserved for future topics.
- **Blast radius the task missed** (callers and tests of `mark-used` / `--exclude-used` / `excludeWorkflow`):
  - `apps/cli/src/commands/store.ts:786-792,855,936-963,1039,1052-1060`
  - `packages/kk-store/src/profile.ts:67` and `tests/profile.test.ts`
  - `apps/cli/tests/{voice2-dag.test.ts:323,345-351,408-420, store-extract.test.ts, store-docs.test.ts:66, commands/store.test.ts}`
  - `docs/03_ARCHITECTURE.md:123-129`
  - `docs/04_DESIGN.md:74-76,95,486-535`
- **Concurrency.** At refine time `plugins/kk/workflows/kk-daily-ai-voice2.yaml` (17 lines: copy, the `publish-prep` dependsOn, the safety `--vars` quoting) and `docs/design/kk-collect-and-daily-voice2.md` carry **uncommitted edits by another session**, and an untracked `kk-daily-ai-voice2.yaml.bak` sits beside them. `apps/cli/plugins/` is a gitignored build copy; never edit it.

**Refine corrections (2026-10-08, cross-task audit from 0230)**

- **A dry run would mark items published.** `publish-classify` is skipped whenever `publish_enabled` is not `"true"` (`kk-daily-ai-voice2.yaml:58,599-602`). The node being renamed has `dependsOn: [publish-classify, extract]`, and under the engine's skip rule a done+skipped mix proceeds (`:628-633` description). So in a dry run, `mark-published` would still promote the rows. R6(b) now adds `&& test "${vars.publish_enabled}" = "true"` to its guard. A dry run leaves its rows `selected`: they still exclude the next day, and `release` returns them to the pool.

### Requirements

- [x] R1. `kk store select --topic <t> --workflow <w> --run <id> --in <path> [--db]`:
  - **Input:** `--in` accepts a Doc[] or an object whose `metadata.docs` is a Doc[] (the `pool-count` shapes). Any other shape fails loud as `kk.store.select.failed`. An empty list writes nothing and prints `{selected: 0}`.
  - **Rows:** one `selections` row per distinct doc id, with `status='selected'`, `rank` = 1-based input order, `story_id` = the item's stored `story_id`, `reason` NULL and `selected_at`. A doc id absent from `items` fails loud and names the id; nothing is written.
  - **Idempotence:** idempotent per `(topic, item_id, run_id)`. A repeat does not reset a `published` or `dropped` row.
  - **Output:** prints `{selected}`.
- [x] R2. `kk store mark-published --topic <t> --run <id> [--in <path>]` moves that run's `selected` rows (or only the listed ids; same `--in` shapes) to `published` and sets `published_at`. It prints `{published}`; a run with no rows prints `{published: 0}` and exits 0.
- [x] R3. `kk store release --run <id> [--topic <t>]` moves that run's `selected` rows to `dropped` and prints `{released}`. It never touches `published` rows.
- [x] R4. `kk store extract --topic <t>` always excludes items whose `story_id` has a `selected` or `published` selection under the SAME topic. `--include-selected` is the explicit opt-out. Remove `--exclude-used` and `ProfileQuery.excludeWorkflow`, replacing it with `excludeTopic?: string`.
- [x] R5. Remove `kk store mark-used` (CLI, `markUsedAction`, `MarkUsedOptions`); R2 replaces it.
- [x] R6. Rewire `kk-daily-ai-voice2.yaml`:
  - **(a) select node.** Add `id: select`, `dependsOn: [qc-content]`, guarded by `kk store pool-count "<candidates>" --min 1`, running `kk store select --topic ai-news --workflow kk-daily-ai-voice2 --run "${vars.__runId}" --in "${vars.work_dir}/21-plan/${vars.run_date}_04_quality-control-content_candidates.json"`. Declare it immediately after `qc-content`, keeping the topological order.
  - **(b) mark-published.** Rename `mark-used` → `mark-published`, keeping its `dependsOn: [publish-classify, extract]`. Its guard becomes the candidates `pool-count --min 1` check `&& test "${vars.publish_enabled}" = "true"`, so a dry run never promotes. Its command is `kk store mark-published --topic ai-news --run "${vars.__runId}"`. Update `run-report.dependsOn`.
  - **(c) extract.** Drop `--exclude-used kk-daily-ai-voice2` from `extract`, and update the descriptions and the `__runId` comment (`:69`) that mention `episode_usage`.
  - **(d) validate.** `spur workflow validate` passes.
- [x] R7. `kk daily prepare --workflow <w>` prints, to stderr, one line per other run id that still holds `selected` rows for that workflow: `kk store release --run <id>`. The check is read-only. A store that is missing or fails to open prints nothing and never fails `prepare`.
- [x] R8. In the same commit, update `docs/04_DESIGN.md` (verbs and flags), `docs/03_ARCHITECTURE.md:123-129`, and design doc §3/§6.

### Acceptance Criteria

- [x] AC1 — A planned item is excluded the next day even when the run never publishes
- [x] AC2 — Exclusion is per topic and per story
- [x] AC3 — Releasing a run returns its items to the pool
- [x] AC4 — Two consecutive daily dry runs produce disjoint pools

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T01:29:40.921Z

- **Re-running a failed day.** A failed run's `selected` rows stay excluding, so a re-run of the same day draws a fresh pool. The operator frees the old picks with `kk store release --run <failed-run>` (the R7 hint). Auto-release was rejected because it would silently re-admit items from a run that may have partially published. Revisit if re-runs become routine.
- **Cooldown / re-entry** of a published story with new developments is out of scope (feature Out).

#### Q&A entry — 2026-10-09T02:41:11.297Z

- **Q: Which file does `select` read?** The QC candidates file, not `03_plan_plan.json` (refine audit). Closed: the plan file is pre-QC, and selecting it would burn items the run rejected.
- **Q: How does `prepare` know a previous run failed?** It doesn't need to. Closed: any other run holding `selected` rows did not reach `mark-published`.
- **Q: Where does `reason` come from?** Closed: NULL in voice2; the column is reserved for future topics.

### Design

**Frozen names**:

| Kind | Names |
|---|---|
| CLI verbs | `select`, `mark-published`, `release` |
| CLI flag | `--include-selected` |
| Error codes | `kk.store.select.failed`, `kk.store.mark-published.failed`, `kk.store.release.failed` |
| Query field | `ProfileQuery.excludeTopic` |
| DAG node ids | `select`, `mark-published` |
| Topic literal | `ai-news` |

**Decisions**:

- Selection is recorded once the run has committed to its episode set, at QC. Publish only promotes the status, so the exclusion invariant no longer depends on the DAG reaching its tail.
- Exclusion is `NOT EXISTS (SELECT 1 FROM selections s WHERE s.topic = ? AND s.story_id = i.story_id AND s.status IN ('selected','published'))` in `selectByProfile`, served by `selections_topic_story_status_idx` (0225).
- The topic is the profile name (`--topic`). `workflow` is provenance only.
- `--in` reuses `countPoolItems`' shape logic, factored into one `readPoolDocs(fs, path)` that both `pool-count` and `select`/`mark-published` call. `pool-count` keeps its "anything else counts 0" semantics; `select` fails loud.

**Concurrency** (other sessions' uncommitted edits to voice2.yaml and the design doc):

- Edit on top of the working copy and never revert their hunks.
- Commit only this task's hunks: `git add -p`, or commit after their changes land. Re-run `git diff` on both files before committing.
- Do not touch `kk-daily-ai-voice2.yaml.bak`.

**Anti-patterns**:

- Selecting from `03_plan_plan.json` (pre-QC).
- Reading spur traces to detect a failed run.
- Auto-release.
- Workflow-keyed exclusion.
- Editing `apps/cli/plugins/**`.
- Inline `jq` in workflow commands (ADR-115).

**Handoffs**:

- **0230** dogfoods two dry runs on the live store and uses `release` on a failed run.
- The E2E artifact `.works/test-artifacts/g32-disjoint-pools.json` holds:

  ```json
  { "run1": { "run", "storyIds" },
    "run2": { "run", "storyIds" },
    "intersection": [],
    "releasedReentered": true }
  ```

### Plan

1. Write the failure-first list:
   - `select` called twice; `select` after `published`;
   - a doc id missing from the store;
   - candidates in the wrong shape and an empty candidates file;
   - `mark-published` for a run with no rows;
   - `release` on a published row;
   - the same story under two topics;
   - two items sharing one `story_id`, where one is selected;
   - extract on an empty store;
   - `prepare` with a missing store;
   - a dry run (`publish_enabled=false`) reaching `mark-published`, which must leave its rows `selected`.
2. Add `readPoolDocs`, the three verbs, `excludeTopic` and `--include-selected`. Remove `mark-used` and `--exclude-used`.
3. Rewire voice2 per R6, respecting the concurrency rule in Design. Update `voice2-dag.test.ts` (node order, guards, dependsOn), then run `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice2.yaml`.
4. Add the `prepare` hint (R7).
5. E2E: seed a temp store, then:
   - run extract → select twice under different run ids and assert disjoint `story_id` sets;
   - `release` run 1 and assert its items re-enter.

   Write `.works/test-artifacts/g32-disjoint-pools.json`.
6. Update docs 03/04/design (R8) and run `bun run gate`.

### Solution

Implemented R1–R8 on top of the uncommitted 0225/0226/0227 work. The `selections` schema, `SelectionsDao.insertMany/updateStatus/listByRun/excludedStories`, `ProfileQuery.excludeTopic` and the `labels_current` CTE were already in place; this pass added the CLI surface, the DAG rewiring, the `prepare` hint and the docs, and removed `mark-used` / `--exclude-used`.

**R1–R3 + R4 flags — CLI (`apps/cli/src/commands/store.ts`)**

- `apps/cli/src/commands/store.ts:1074-1116` — option interfaces: `ExtractOptions` gains `includeSelected?` and drops `excludeUsed?`; new `SelectOptions`, `MarkPublishedOptions`, `ReleaseOptions`.
- `apps/cli/src/commands/store.ts:1177-1210` — `extractAction` compiles `excludeTopic: options.topic` unless `--include-selected` (the interim `--exclude-used → 'ai-news'` mapping is gone).
- `apps/cli/src/commands/store.ts:1229-1248` — new `readPoolDocs(fs, path)`: a bare `Doc[]` or an object whose `metadata.docs` is one; a missing file, invalid JSON or any other shape throws. This is the one shape reader the Design names.
- `apps/cli/src/commands/store.ts:1250-1257` — `countPoolItems` now delegates to `readPoolDocs` and keeps `pool-count`'s "anything else counts 0" semantics (the throw is caught).
- `apps/cli/src/commands/store.ts:1296-1343` — `selectAction`: reads every doc's item BEFORE writing (`store.items.findById`), so a doc id the store does not hold fails loud naming it with zero rows written; one row per distinct id (first occurrence wins `rank`, 1-based input order), `story_id` from the stored item, `reason` NULL, `status: 'selected'`, `selected_at` now; writes through `insertMany` (one statement, `ON CONFLICT DO NOTHING`, so a repeat writes 0 and never resets a promoted row); prints `{selected}`.
- `apps/cli/src/commands/store.ts:1345-1371` — `markPublishedAction`: optional `--in` narrows `updateStatus` to the listed ids; prints `{published}` (0 for a run with no rows, exit 0).
- `apps/cli/src/commands/store.ts:1373-1405` — `releaseAction`: `--topic` narrows; without it the run's own rows name the topics (`listByRun` → distinct topics of `selected` rows) and each is moved to `dropped`. Reuses the existing `SelectionsDao.updateStatus`, whose WHERE is `status = 'selected'`, so `published` rows can never move.
- `apps/cli/src/commands/store.ts:1523` (`--include-selected`), `:1536-1543` (`select`), `:1546-1553` (`mark-published`), `:1555-1561` (`release`) — command registration; `markUsedAction` / `MarkUsedOptions` / the `mark-used` command deleted (R5).

**R7 — `apps/cli/src/commands/store.ts:129` (`SelectionsDao.selectedRuns`) + `apps/cli/src/commands/daily.ts:132-157`, called at `apps/cli/src/commands/daily.ts:186`**

`SELECT DISTINCT run_id FROM selections WHERE workflow = ? AND status = 'selected'` — the runs that did not reach `mark-published`. `warnUnreleasedRuns` writes one stderr line per run carrying `kk store release --run <id>`, is read-only, and returns silently when the resolved store path does not exist or `openStore` throws (so `prepare` never fails and never creates a store). `selectedRuns` is the only addition outside the task's backticked file list: the ADR-030 boundary forbids raw SQL in `apps/cli`, and no existing accessor reads by `workflow`.

**R6 — `plugins/kk/workflows/kk-daily-ai-voice2.yaml`**

- `:119-131` — `extract` loses `--exclude-used kk-daily-ai-voice2` and its description names the `selections` ledger.
- `:164-181` — new `select` node declared immediately after `qc-content`, `dependsOn: [qc-content]`, guarded by `kk store pool-count "<candidates>" --min 1`, running `kk store select --topic ai-news --workflow kk-daily-ai-voice2 --run "${vars.__runId}" --in "<candidates>"` (topological order preserved).
- `:632-650` — `mark-used` renamed `mark-published`, `dependsOn: [publish-classify, extract]` kept, guard is the candidates check `&& test "${vars.publish_enabled}" = "true"` (a dry run never promotes), command `kk store mark-published --topic ai-news --run "${vars.__runId}"`.
- `:658` — `run-report.dependsOn` now lists `mark-published`.
- `:7-8`, `:69` — the `episode_usage` / `mark-used` comments and the top-level description updated.
- `spur workflow validate` passes (evidence below).

**R8 — docs**

- `docs/03_ARCHITECTURE.md:122-131` — the Persistent-store paragraph: verb list, the topic-scoped `NOT EXISTS selections` exclusion (`--include-selected` opt-out) and the `select`/`mark-published`/`release` ledger.
- `docs/04_DESIGN.md:99-102` (the `store extract` / `store select` / `store mark-published` / `store release` command-table rows; the verb-list block at :76-80 updated with them) and `docs/04_DESIGN.md:574-648` (§1.9: the extract exclusion prose, plus a new "topic-scoped selection ledger" block covering the three verbs and the `prepare` hint).
- `docs/design/kk-collect-and-daily-voice2.md:17,28,42` (diagram + §2 tables), `:69-72` (§3 verb table), `:166-197` (§6 node map, extract bullet, new `select` / `mark-published` / `prepare` bullets) and `:241` (P3 rollout row).

**Tests**

- New `apps/cli/tests/store-selections.test.ts` (17 tests) — the three verbs end to end against a temp store (both `--in` shapes, the third shape failing loud, unknown id writing nothing, empty list, idempotence, `mark-published` subset + `dropped` refusal, release/`--topic` narrowing, story- and topic-scoped exclusion, `--include-selected`, the disjoint-pools E2E, the R7 hint incl. missing/unopenable store).
- `apps/cli/tests/store-extract.test.ts` — the `mark-used` describe replaced by "the topic-scoped selection exclusion (R4/AC2)"; the config-path test kept.
- `apps/cli/tests/voice2-dag.test.ts:320-327,409-438,583,627` — extract has no `--exclude-used`, `mark-used` is gone, the `select` node order/guard/command, `mark-published`'s position and dry-run guard, and the two real DAG runs (a dry run must not call `store mark-published`).
- `apps/cli/tests/commands/store.test.ts:37-113` — the command/option inventory. `apps/cli/tests/store-docs.test.ts:62-70` — the 04_DESIGN verb list.
- Evidence artifact `.works/test-artifacts/g32-disjoint-pools.json` (run1/run2 story ids, empty intersection, `releasedReentered: true`) plus `.works/test-artifacts/g32/select.json`.

**AC coverage**: AC1 — `store-selections.test.ts` "records one selected row per distinct doc… (R4/AC1)" (select → never publish → the next extract excludes) and the `voice2-dag` guard test; AC2 — "excludes every item of a selected story, and only under the selecting topic"; AC3 — "returns a failed run's selected items to the pool and never touches published rows"; AC4 — "leaves the second run exactly the items the first did not select".

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `selectAction` at `apps/cli/src/commands/store.ts:1438` (options `apps/cli/src/commands/store.ts:1233`, registration `apps/cli/src/commands/store.ts:1678`) over `SelectionsDao.insertMany` at `packages/kk-store/src/dao/selections.ts:59`. Tests re-run this pass: `apps/cli/tests/store-selections.test.ts:212` (rows, rank, exclusion), `:287` (Doc[] shape), `:312` (third shape fails loud, nothing written), `:339` (unknown id named, nothing written), `:368` (`{selected: 0}`). |
| R2 | MET | `markPublishedAction` at `apps/cli/src/commands/store.ts:1487` (options `apps/cli/src/commands/store.ts:1242`, registration `apps/cli/src/commands/store.ts:1688`) over `updateStatus` at `packages/kk-store/src/dao/selections.ts:93`. Tests: `apps/cli/tests/store-selections.test.ts:395` (listed ids + `published_at`), `:445` (`{published: 0}` exit 0), `:465` (never promotes dropped). |
| R3 | MET | `releaseAction` at `apps/cli/src/commands/store.ts:1515` (options `apps/cli/src/commands/store.ts:1251`, registration `apps/cli/src/commands/store.ts:1697`). Tests: `apps/cli/tests/store-selections.test.ts:495` (selected→dropped, published untouched), `:580` (unknown run `{released: 0}`). |
| R4 | MET | `extractAction` at `apps/cli/src/commands/store.ts:1330` passes `excludeTopic` unless `--include-selected` (`apps/cli/src/commands/store.ts:1345-1346`, flag `apps/cli/src/commands/store.ts:1665`); `ProfileQuery.excludeTopic` at `packages/kk-store/src/profile.ts:73`; SQL story-scoped `NOT EXISTS` at `packages/kk-store/src/dao/items.ts:436-445`. grep this pass: zero `excludeWorkflow` / `exclude-used` in `apps/cli/src`, `packages/kk-store/src`, `plugins/kk/workflows`. Tests: `apps/cli/tests/store-selections.test.ts:591`, `:635`, `:659`; `apps/cli/tests/store-extract.test.ts:401`. |
| R5 | MET | grep this pass: zero `mark-used` / `markUsed` / `MarkUsed` in `apps/cli/src` and `plugins/kk/workflows`; the registered-verb list asserted at `apps/cli/tests/commands/store.test.ts:38` omits it. |
| R6 | MET | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:164-182` `select` node (`dependsOn: [qc-content]`, pool-count guard, `kk store select --topic ai-news --workflow kk-daily-ai-voice2 --run "${vars.__runId}" --in …_candidates.json`); `plugins/kk/workflows/kk-daily-ai-voice2.yaml:632-650` `mark-published` (guard `pool-count --min 1 && test "${vars.publish_enabled}" = "true"`); extract at `plugins/kk/workflows/kk-daily-ai-voice2.yaml:119-126` carries no `--exclude-used` and describes the `selections` ledger. `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice2.yaml` → `workflow valid: kk-daily-ai-voice2` this pass. Test `apps/cli/tests/voice2-dag.test.ts:431`. |
| R7 | MET | `apps/cli/src/commands/daily.ts:142-144` iterates `selectedRuns(workflow)` (`packages/kk-store/src/dao/selections.ts:129`) and prints the `kk store release --run <id>` hint to stderr; read-only open documented at `apps/cli/src/commands/daily.ts:125`. Tests: `apps/cli/tests/store-selections.test.ts:762` (hint + read-only), `:825` (missing/unopenable store prints nothing, never fails), `:836` (no runs). |
| R8 | MET | `docs/04_DESIGN.md:79-81` verb usage lines and `docs/04_DESIGN.md:101-102` command rows; `docs/03_ARCHITECTURE.md:124-127` store surface names `select |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A planned item is excluded the next day even when the run never publishes | MET | test | `apps/cli/tests/store-selections.test.ts:212` (select excludes pool without publish) + `apps/cli/tests/voice2-dag.test.ts:431` (select runs at QC, mark-published only when publishing); re-run this pass, 0 fail. |
| AC2 — Exclusion is per topic and per story | MET | test | `apps/cli/tests/store-selections.test.ts:591` "excludes every item of a selected story, and only under the selecting topic"; re-run this pass. |
| AC3 — Releasing a run returns its items to the pool | MET | test | `apps/cli/tests/store-selections.test.ts:495` and `apps/cli/tests/store-selections.test.ts:681`; re-run this pass. |
| AC4 — Two consecutive daily dry runs produce disjoint pools | MET | test | `apps/cli/tests/store-selections.test.ts:681` "leaves the second run exactly the items the first did not select"; re-run this pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0228

**Scope:** the worktree's uncommitted batch diff, content-scoped to 0228 — `apps/cli/src/commands/store.ts` (`SelectOptions`/`MarkPublishedOptions`/`ReleaseOptions`, `readPoolDocs`, `selectAction`, `markPublishedAction`, `releaseAction`, `--include-selected`, `excludeTopic` wiring, the `mark-used` deletion), `apps/cli/src/commands/daily.ts` (`warnUnreleasedRuns`), `packages/kk-store/src/dao/selections.ts` (`selectedRuns`), `plugins/kk/workflows/kk-daily-ai-voice2.yaml` (the `select` node, `mark-used` → `mark-published`, the `extract` change), `apps/cli/tests/store-selections.test.ts` (new), `store-extract.test.ts`, `voice2-dag.test.ts`, `commands/store.test.ts`, `store-docs.test.ts`, and the R8 docs (`docs/03_ARCHITECTURE.md`, `docs/04_DESIGN.md`, `docs/design/kk-collect-and-daily-voice2.md`). 0225/0226/0227 files (migration internals, the `selections` DDL/DAO internals, the label v2 pass, `--replay`, `facts.ts`, `story.ts`) were excluded as out of scope; residuals 0231–0234 were not re-litigated.
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture depth
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 (minor) | architecture | `SelectionsDao.excludedStories` has **no production caller**: R4's exclusion is inline SQL inside `ItemsDao.selectByProfile`, so the accessor 0225 R6 handed over is kept alive only by its own DAO tests. It is the only uncovered code in this task's run (`dao/selections.ts` 93.33% lines / 81.82% funcs; `:143-150` uncovered). Either delete it or route the R4 `NOT EXISTS` through it, so the topic/story/status rule has one home rather than two. | `packages/kk-store/src/dao/selections.ts:143-150`; duplicate rule at `packages/kk-store/src/dao/items.ts:441-444`; only callers are tests (`packages/kk-store/tests/dao/selections.test.ts:91-93`) | DEFER (0230) |
| 2 | P4 (advisory) | correctness | `mark-published` promotes the run's **whole** `selected` set for the topic whenever its guard passes; the guard never consults `publish-status.txt`, which `publish-classify` writes as `full`, `partial` or `none` and exits 0 for all three. With `publish_enabled=true` and a *partial* publish, items that never aired are promoted, and `release` cannot undo it — `updateStatus`'s WHERE is `status = 'selected'`. R2 explicitly specifies whole-run promotion and the Q&A records the trade-off, so this is a design consequence, not a spec breach; recorded so 0230's live dogfood can decide whether the DAG should pass `--in` with the aired subset. | `plugins/kk/workflows/kk-daily-ai-voice2.yaml:632-650`; `packages/kk-store/src/dao/selections.ts:93-107` | ACCEPTED (0230) |
| 3 | P4 (advisory) | architecture | `release` without `--topic` implements "which topics does this run own?" as a CLI-side read (`listByRun`) plus N `updateStatus` round trips. A single `SelectionsDao.release(runId, topic?)` owning that policy would be the deeper seam (one statement, testable without the CLI) — the module currently leaks a two-step protocol to its caller. | `apps/cli/src/commands/store.ts:1373-1391` | ACCEPTED (0230) |
| 4 | P4 (advisory) | correctness | `updateStatus` reports its row count via `SELECT changes()`, a connection-global counter. Safe today — one `bun:sqlite` `Database` per store, awaited sequentially per invocation — but two `updateStatus` calls interleaved on one adapter would misreport `{published}` / `{released}`. Counts are informational; no requirement depends on them. | `packages/kk-store/src/dao/selections.ts:93-111` | ACCEPTED (0230) |
| 5 | P4 (advisory) | documentation | The `## Solution` section cites `SelectionsDao.selectedRuns` at `apps/cli/src/commands/store.ts:129`; the accessor is at `packages/kk-store/src/dao/selections.ts:129` (the CLI file has no such line). Every other citation in `## Solution` was spot-checked and resolves correctly. | task `0228` `## Solution`, the R7 bullet | ACCEPTED (0230) |

No P1/P2 finding. Nothing blocks a requirement or an acceptance criterion of 0228.

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `SelectOptions` (`store.ts:1091-1098`) carries `--topic --workflow --run --in --db`, all four required (`:1536-1543`). `readPoolDocs` (`:1229-1248`) accepts a bare `Doc[]` or `metadata.docs`, and throws on a missing/unparseable file or any third shape (`:1242-1247`); `countPoolItems` (`:1250-1257`) delegates and keeps `pool-count`'s "anything else counts 0" semantics. `selectAction` (`:1296-1330`) builds `rank` first-occurrence, 1-based, from a `Map` keyed by `doc.id` (`:1304-1307`), then does **every** `store.items.findById` before any write (`:1313-1325`) — an unknown id throws naming it before `insertMany` runs (`:1318-1320`) — one `selections.insertMany` of `status:'selected'`, `storyId` from the stored item, `reason: null`, `selectedAt: now` (`:1316-1327`). Idempotence is the DAO's `ON CONFLICT(topic, item_id, run_id) DO NOTHING RETURNING item_id` (`selections.ts:78-82`), so a repeat returns 0 rows and never resets a promoted row; the empty list short-circuits to 0 (`selections.ts:60`). Tests: "records one selected row per distinct doc, in input order…" (`store-selections.test.ts:209-283`, rank 1 then 2, `story_id`, `reason: null`, repeat → `{selected: 0}` while status stays `selected`), "accepts a `Doc[]` input as well as the metadata.docs shape" (`:284`), "fails loud on a third input shape, writing nothing" (`:309`, `countRows(selections) === 0`), "names an unknown doc id and writes nothing at all" (`:336`, a valid id precedes the ghost id and 0 rows land), "writes nothing and prints `{selected: 0}` for an empty list" (`:365`). |
| R2 | MET | `markPublishedAction` (`store.ts:1345-1362`) reads the optional `--in` through the same `readPoolDocs`, de-duplicates the ids, and calls `selections.updateStatus(run, topic, 'published', itemIds)`. The DAO stamps `published_at = now` for `published` (`selections.ts:96-97`) and its WHERE is `run_id = ? AND topic = ? AND status = 'selected'` (`:99-102`), so the "only `selected` rows" guarantee lives in the SQL, not the caller; an explicit empty `--in` returns 0 without touching the table (`:94-95`). Tests: "promotes only the listed ids and stamps `published_at`" (`:392`), "prints `{published: 0}` and exits 0 for a run with no rows" (`:442`), "never promotes a dropped row" (`:462` — select then release, then mark-published → `{published: 0}`, row still `dropped`). |
| R3 | MET | `releaseAction` (`store.ts:1373-1397`) with `--topic` is one `updateStatus(run, topic, 'dropped')`; without it, the run's own `selected` rows name the topics (`listByRun` → distinct topics, `:1383-1391`) and each is moved. `updateStatus`'s unchanged `status = 'selected'` WHERE means a `published` row can never move, and `published_at` is cleared only for a row that was `selected`. Tests: "returns a failed run's selected items to the pool and never touches published rows" (`:492` — `{released: 2}` then the pool is whole again; a published run releases 0 and its items stay out; `--topic` narrows to one topic while the same run's other topic stays `selected`), "exits 0 with `{released: 0}` for an unknown run" (`:577`). |
| R4 | MET | `selectByProfile` adds `NOT EXISTS (SELECT 1 FROM selections s WHERE s.topic = ? AND s.story_id = i.story_id AND s.status IN ('selected','published'))` as a parameterized condition, keeping all SQL inside `kk-store` (`items.ts:436-445`); `extractAction` sets `excludeTopic: options.topic` unless `--include-selected` (`store.ts:1200-1206`), and the flag is registered as an opt-out (`:1523`). `ProfileQuery.excludeTopic` replaces `excludeWorkflow` (`profile.ts:68,85,226`). Removals confirmed: `grep -rn "excludeUsed\\|excludeWorkflow\\|exclude-used" apps packages plugins` → only negative assertions in tests; `grep -rn "markUsed\\|MarkUsedOptions" apps packages plugins` → none. Tests: "excludes every item of a selected story, and only under the selecting topic" (`store-selections.test.ts:588` — two items clustered onto one `story_id`, one selected under `ai-news`; the `ai-news` pool is empty while the same story's `ai-research` item is still returned), "`--include-selected` is the explicit opt-out" (`:632`), "no longer accepts `--exclude-used`…" (`:656`), plus the rewritten `store-extract.test.ts` exclusion cases. |
| R5 | MET | `mark-used` is gone from the source (`markUsedAction`, `MarkUsedOptions`, the command). The command inventory test pins the exact registered list — `migrate, lock, ingest, backfill-facts, label, extract, pool-count, select, mark-published, release` — so the absent verb is a test failure, not a silent drift (`apps/cli/tests/commands/store.test.ts:38-51`); the DAG likewise asserts no `mark-used` node (`apps/cli/tests/voice2-dag.test.ts:326`). |
| R6 | MET | (a) `select` is declared immediately after `qc-content` (`kk-daily-ai-voice2.yaml:151` → `:164`), `dependsOn: [qc-content]`, guard `kk store pool-count "<candidates>" --min 1`, command `kk store select --topic ai-news --workflow kk-daily-ai-voice2 --run "${vars.__runId}" --in "<candidates>"` (`:164-181`) — asserted by `voice2-dag.test.ts:410-421` (`ids[ids.indexOf('qc-content') + 1] === 'select'`). (b) `mark-published` at `:632-650` keeps `dependsOn: [publish-classify, extract]` and its guard is exactly the candidates `--min 1` check `&& test "${vars.publish_enabled}" = "true"`; `run-report.dependsOn` lists it (`:658`). (c) `extract` drops `--exclude-used` (`:118-131`) and no `episode_usage` reference survives in the file (grep: 0 hits); the `__runId` comment (`:68-69`) and the top description (`:7-8`) name the `selections` ledger. (d) `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice2.yaml` → `workflow valid: kk-daily-ai-voice2 (unversioned)`, exit 0. Dry run cannot promote — **observed, not just asserted**: in the real DAG run's call log the guard was reached (`store pool-count …candidates.json --min 1`, `.works/test-artifacts/0211/voice2-concurrent-calls.log:27`) and refused on the `test` clause, while `store mark-published` never appears in either the full-pool or the empty-pool log (`voice2-dag.test.ts:606,652` assert it). |
| R7 | MET | `SelectionsDao.selectedRuns` is `SELECT DISTINCT run_id FROM selections WHERE workflow = ? AND status = 'selected' ORDER BY run_id` (`selections.ts:129-139`) — the runs that never reached `mark-published`. `warnUnreleasedRuns` (`daily.ts:132-157`) short-circuits on a missing store path, opens read-only, writes one `consoleOutput.error` line per run id (→ `echoError`, stderr; `apps/cli/src/output.ts:19-29`), and swallows an open failure; it is called from `prepareAction` after the workspace is composed (`daily.ts:186`). Tests: "names every other run that still holds selected rows, and is read-only" (`store-selections.test.ts:759` — names `run-old`, stays silent for a published run and another workflow's run, asserts `result.err` and an unchanged row count), "prints nothing and never fails when the store is missing or unopenable" (`:822`, including a directory used as the store), "prints nothing when no run holds selected rows" (`:833`). |
| R8 | MET | `docs/03_ARCHITECTURE.md:122-131` — the verb list gains `backfill-facts`, `select`, `mark-published`, `release`, drops `mark-used`, and describes the topic-scoped `NOT EXISTS selections` exclusion with `--include-selected` as the opt-out. `docs/04_DESIGN.md:73-80` (usage block) and `:96-104` (command table) list the three verbs and the changed `extract` flag; `:618-646` (§1.9) documents each verb's contract, the failure codes and the `prepare` hint, and `:604-616` the exclusion predicate. `docs/design/kk-collect-and-daily-voice2.md:17,28,42` (diagram/tables), `:69-72` (§3 verb table), `:169,187,195-197` (§6 node map). The verb list is test-pinned (`apps/cli/tests/store-docs.test.ts:58-73`). |

##### AC verification

| AC | Status | Proving test / evidence |
|----|--------|-------------------------|
| AC1 — A planned item is excluded the next day even when the run never publishes | MET | `apps/cli/tests/store-selections.test.ts:209-283` "records one selected row per distinct doc, in input order, and excludes the pool (R4/AC1)": two candidates selected under `run-1`, **no** `mark-published` call anywhere in the test, and the next `extract` returns only the two unplanned ids; the test also writes `.works/test-artifacts/g32/select.json` (`planned`, `printed: {selected: 2}`, `repeat: {selected: 0}`, `nextDayPool`). Complementary DAG evidence: the dry-run harness proves `mark-published` is never dispatched (`voice2-dag.test.ts:606`, and `.works/test-artifacts/0211/voice2-concurrent-calls.log` with no `store mark-published` line). |
| AC2 — Exclusion is per topic and per story | MET | `apps/cli/tests/store-selections.test.ts:588-631` "excludes every item of a selected story, and only under the selecting topic": two items with identical titles cluster onto one `story_id` (asserted); selecting `n1` under `ai-news` empties the whole `ai-news` pool, while the same story's `r1` still comes back from `ai-research`. Per item, not just the selected one: the pool is empty, and `--include-selected` restores all four items (`:632-655`). |
| AC3 — Releasing a run returns its items to the pool | MET | `apps/cli/tests/store-selections.test.ts:492-576`: after `select`, `extract` returns only the two remaining ids; `release --run run-1` prints `{released: 2}` and `extract` returns all four; a published run releases 0 and its items stay excluded; `--topic` narrowing leaves the same run's other topic `selected`. |
| AC4 — Two consecutive daily dry runs produce disjoint pools | MET | `apps/cli/tests/store-selections.test.ts:678-745` "leaves the second run exactly the items the first did not select": run 1's pool is 4 items, run 1 selects 2, run 2's pool is exactly the other 2 with an empty intersection, then `release` re-admits everything; the test writes `.works/test-artifacts/g32-disjoint-pools.json` (regenerated by this review's run, mtime 22:46) with `run1.storyIds`, `run2.storyIds`, `intersection: []`, `releasedReentered: true`. This is the pool-level invariant 0228 owns; the *live* two-DAG-dry-run form is 0230 R4's E2E (`g32-live-disjoint.json`), as the Design's Handoff states — not a gap in 0228. |

##### Independent verification performed in this run

1. `NODE_ENV=test bun test apps/cli/tests/store-selections.test.ts` → **17 pass / 0 fail, 85 expect() calls**; coverage on the touched source: `packages/kk-store/src/dao/selections.ts` 93.33% lines / 81.82% funcs (only `excludedStories` uncovered — finding 1), `apps/cli/src/commands/daily.ts` exercised through the R7 tests.
2. `NODE_ENV=test bun test apps/cli/tests/{voice2-dag,store-extract,commands/store,store-docs}.test.ts` → **53 pass / 0 fail** (this includes the two real `spur workflow run` DAG executions and the workflow-definition assertions).
3. `NODE_ENV=test bun test packages/kk-store/tests/dao/selections.test.ts packages/kk-store/tests/profile.test.ts` → **15 pass / 0 fail** (the `excludeTopic` override and the story/topic-scoped `excludedStories` semantics).
4. `spur workflow validate plugins/kk/workflows/kk-daily-ai-voice2.yaml` → `workflow valid: kk-daily-ai-voice2 (unversioned)`, exit 0.
5. `bun run --filter './apps/cli' typecheck` → exit 0; `bunx biome check` over `apps/cli/src/commands/store.ts`, `apps/cli/src/commands/daily.ts`, `packages/kk-store/src/dao/selections.ts`, `apps/cli/tests/store-selections.test.ts` → clean.
6. Read the harness call logs rather than trusting the descriptions: `.works/test-artifacts/0211/voice2-concurrent-calls.log:5` (`stage daily-qc-content`) → `:12` (`store select …`), the guard's refusals, and no `store mark-published`; `.works/test-artifacts/0211/voice2-empty-pool-calls.log` shows the candidates guard evaluated and `store select` never dispatched on an empty pool.
7. **Not run by me:** `bun run gate` / the whole-repo suite / the `spur rule` presets. Also note the task's `## Testing` section is **empty**, so every measurement above is this review's own evidence — none of it is the driver's.

##### Residual risk

- **Partial (or failed) publish promotes the whole planned set** (finding 2). R2 specifies it and the Q&A accepted the trade-off, but the operator should know the recovery asymmetry: `release` returns `selected` rows to the pool and can never undo a `published` one.
- **Engine behaviour on a *failed* publish leaf is unverified.** The rationale for R6(b)'s extra `test` clause rests on the engine rule "all-deps-skipped ⇒ skip, a done+skipped mix proceeds", which I confirmed only for the *skipped* half (the dry-run log). Whether a **failed** `publish-classify` also lets `mark-published` proceed with `publish_enabled=true` could not be checked — the DAG engine ships inside the `spur` binary, not this repo. If it does, that path promotes unrecoverably. No 0228 requirement or AC covers it; flagged for 0230's live dogfood.
- **A NULL `story_id` item is never excluded** (`NULL = s.story_id` is not true), while `select` defends with `item.storyId ?? id` (`store.ts:1321`). 0225's migration backfills `story_id = id` and 0227's insert always supplies one, so the state is unreachable today — 0230 R1's live migration is what keeps it so. Worth a defensive `COALESCE(i.story_id, i.id)` only if a future writer can insert NULL.
- **The R7 hint can name the current run** if a run id is re-prepared after its own `select` (e.g. an explicit `spur workflow run --run-id <same>`). The Q&A's "`prepare` runs before this run's `select`" holds for a fresh run id only; the hint is advisory, so the worst case is a misleading line.
- **Uncovered by any test** (probe not completed — the sandbox cancelled my `/tmp` probe): a `Doc[]` whose entries carry no `id` (e.g. `{}`). By code reading it fails loud through `findById` before any write, but I did not execute it, so it is reported as unverified rather than as a defect.
- **Docs beyond R8's list still say `mark-used`:** `docs/05_FEATURES.md:98` (G31's shipped-verb parenthetical) and `docs/features/G31*.md:20,167`. Both are historical records of what 0210 shipped rather than live verb lists, and R8 named only 03/04/design — not counted as a finding, mentioned so nobody re-discovers them as drift.

**Disposition:** R1–R8 and AC1–AC4 are MET, verified against the code, the new and rewritten tests, `spur workflow validate`, a typecheck/lint pass, and the real DAG executions' call logs. The single P3 is a dead DAO accessor with no production caller, deferred to 0230; the P4s are one design consequence of R2's whole-run promotion, one deepening opportunity, one adapter-level counting note and one wrong path in `## Solution`. Nothing blocks a requirement or an acceptance criterion. Verdict: PASS.

### References

- Feature G32 (R9, R10, R11, R12). Brainstorm D4. Depends on 0225 (`selections`, `SelectionsDao`) and 0227 (`story_id`).
- `plugins/kk/workflows/kk-daily-ai-voice2.yaml:69,118-147,149-160,590-626,628-640`.
- `plugins/kk/scripts/daily-stages.ts:112-185` (qc-content and topic boundary), `:576-598` (dailyPlan).
- `apps/cli/src/commands/store.ts:786-792,855,896-934,936-963,1030-1060`; `apps/cli/src/commands/daily.ts:123-167` (prepare).
- `packages/kk-store/src/profile.ts:67`, `src/dao/items.ts:284-287`.
- Tests: `apps/cli/tests/{voice2-dag,store-extract,store-docs,commands/store}.test.ts`, `packages/kk-store/tests/{profile,dao/items}.test.ts`.
- Docs: `docs/03_ARCHITECTURE.md:123-129`, `docs/04_DESIGN.md:74-76,95,486-535`, `docs/design/kk-collect-and-daily-voice2.md` §3 (`:61`), §6 (`:143`).

### History

- 2026-10-09T02:45:15.591Z backlog → todo (system)
- 2026-10-09T05:42:26.560Z todo → wip (system)
- 2026-10-09T06:35:57.480Z wip → testing (system)
- 2026-10-09T06:36:30.408Z testing → done (system)

