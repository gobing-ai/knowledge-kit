---
schema_version: 1
name: "Topic-scoped selections: kk store select, mark-published, release; story exclusion; voice2 select node"
status: todo
template: feature-impl
created_at: 2026-10-09T01:27:20.108Z
updated_at: "2026-10-09T02:45:15.591Z"
feature_id: G32

dependencies: ["0225", "0227"]
priority: P1
estimate_hours: 5
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

- [ ] R1. `kk store select --topic <t> --workflow <w> --run <id> --in <path> [--db]`:
  - **Input:** `--in` accepts a Doc[] or an object whose `metadata.docs` is a Doc[] (the `pool-count` shapes). Any other shape fails loud as `kk.store.select.failed`. An empty list writes nothing and prints `{selected: 0}`.
  - **Rows:** one `selections` row per distinct doc id, with `status='selected'`, `rank` = 1-based input order, `story_id` = the item's stored `story_id`, `reason` NULL and `selected_at`. A doc id absent from `items` fails loud and names the id; nothing is written.
  - **Idempotence:** idempotent per `(topic, item_id, run_id)`. A repeat does not reset a `published` or `dropped` row.
  - **Output:** prints `{selected}`.
- [ ] R2. `kk store mark-published --topic <t> --run <id> [--in <path>]` moves that run's `selected` rows (or only the listed ids; same `--in` shapes) to `published` and sets `published_at`. It prints `{published}`; a run with no rows prints `{published: 0}` and exits 0.
- [ ] R3. `kk store release --run <id> [--topic <t>]` moves that run's `selected` rows to `dropped` and prints `{released}`. It never touches `published` rows.
- [ ] R4. `kk store extract --topic <t>` always excludes items whose `story_id` has a `selected` or `published` selection under the SAME topic. `--include-selected` is the explicit opt-out. Remove `--exclude-used` and `ProfileQuery.excludeWorkflow`, replacing it with `excludeTopic?: string`.
- [ ] R5. Remove `kk store mark-used` (CLI, `markUsedAction`, `MarkUsedOptions`); R2 replaces it.
- [ ] R6. Rewire `kk-daily-ai-voice2.yaml`:
  - **(a) select node.** Add `id: select`, `dependsOn: [qc-content]`, guarded by `kk store pool-count "<candidates>" --min 1`, running `kk store select --topic ai-news --workflow kk-daily-ai-voice2 --run "${vars.__runId}" --in "${vars.work_dir}/21-plan/${vars.run_date}_04_quality-control-content_candidates.json"`. Declare it immediately after `qc-content`, keeping the topological order.
  - **(b) mark-published.** Rename `mark-used` → `mark-published`, keeping its `dependsOn: [publish-classify, extract]`. Its guard becomes the candidates `pool-count --min 1` check `&& test "${vars.publish_enabled}" = "true"`, so a dry run never promotes. Its command is `kk store mark-published --topic ai-news --run "${vars.__runId}"`. Update `run-report.dependsOn`.
  - **(c) extract.** Drop `--exclude-used kk-daily-ai-voice2` from `extract`, and update the descriptions and the `__runId` comment (`:69`) that mention `episode_usage`.
  - **(d) validate.** `spur workflow validate` passes.
- [ ] R7. `kk daily prepare --workflow <w>` prints, to stderr, one line per other run id that still holds `selected` rows for that workflow: `kk store release --run <id>`. The check is read-only. A store that is missing or fails to open prints nothing and never fails `prepare`.
- [ ] R8. In the same commit, update `docs/04_DESIGN.md` (verbs and flags), `docs/03_ARCHITECTURE.md:123-129`, and design doc §3/§6.

### Acceptance Criteria

- [ ] AC1 — A planned item is excluded the next day even when the run never publishes
- [ ] AC2 — Exclusion is per topic and per story
- [ ] AC3 — Releasing a run returns its items to the pool
- [ ] AC4 — Two consecutive daily dry runs produce disjoint pools

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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

