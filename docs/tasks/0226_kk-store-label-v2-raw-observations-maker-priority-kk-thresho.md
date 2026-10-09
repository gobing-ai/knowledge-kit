---
schema_version: 1
name: "kk store label v2: raw observations, maker priority + kk threshold, labels_current extract, --replay"
status: todo
template: feature-impl
created_at: 2026-10-09T01:27:19.603Z
updated_at: "2026-10-09T02:45:14.497Z"
feature_id: G32

dependencies: ["0225"]
priority: P2
estimate_hours: 5
---

## 0226. kk store label v2: raw observations, maker priority + kk threshold, labels_current extract, --replay

### Background

Today the label pass keeps only the enum confidence level. It drops the raw 0–1 confidence, the reason and the consult cost (`apps/cli/src/commands/store.ts:586-606`). When an answer falls below the catalog `minConfidence: 0.8` (`plugins/kk/decisions/kk-items.yaml:16`), spur returns the fallback and the model's answer is lost. Backtesting different decision makers on the same item pool needs all of that evidence, plus a way to re-label history with another maker without disturbing production selection.

Depends on 0225, which supplies the observation identity and columns.

Verified: the spur catalog schema accepts `minConfidence` in [0, 1] at both the defaults and per-decision level (`@gobing-ai/spur/schemas/decision-catalog.schema.json`).

**Refine corrections (2026-10-08)**

- **No generic "kk config loader" exists.** The only reader is `readStoreDbPath` in `packages/kk-store/src/config.ts:26-45`, which reads `store.db_path` alone; apps/cli passes `resolveKkConfigPath()` (`apps/cli/src/invoke.ts:52`). R3 now freezes a new `readStoreConfig` in that file.
- The catalog already declares `version: 1` (`kk-items.yaml:13`); `minConfidence` sits at `:18`, not `:16`. R1 bumps it to `2`.
- Line refs:
  - the raw→enum drop is `labelRow`, `store.ts:590-625`, not `:586-606`;
  - `DecisionResult` is at `store.ts:328-336`;
  - the write loop is `upsertLabel` at `store.ts:738-749`.
- **R5 as filed contradicted G31 R14.** It derived the level against the kk threshold, so a 0.5–0.8 answer would turn `LOW` and the MEDIUM band would silently vanish. Corrected: the level keeps `labelConfidence` (`dao/labels.ts:38-43`, HIGH ≥0.8 / MEDIUM ≥0.5). `min_confidence` gates only `labels_current` eligibility.
- **Replay isolation was not guaranteed.** "An unlisted maker ranks last" lets a replay maker win wherever production has no row; 0229's model-only decisions have no heuristic row. Corrected in R4: a `replay-*` row is eligible only when its maker is **explicitly** listed.
- **The label path today writes either a heuristic row or a maker row per decision, never both** (`labelRow`, `store.ts:612-623`). Backtesting needs the heuristic as its own maker, so R2 now freezes "always write the heuristic observation when an annotation exists".
- The heuristic itself runs out of process: `kk executor run episode-plan-gen` with `EPISODE_PLAN_MODE=label`, because apps/cli imports no plugin source (`store.ts:690-705` doc). 0226 keeps that path.

### Requirements

- [ ] R1. In `plugins/kk/decisions/kk-items.yaml`, set `defaults.minConfidence: 0` (`:18`) and bump `version: 1` → `2` (`:13`). The catalog `version` is the `catalog_version` stamped on every observation; the label pass reads it from the catalog file and falls back to `'unknown'` when the read fails.
- [ ] R2. The label pass writes observations through `store.labels.recordObservation`:
  - **Heuristic row:** written for every item with a heuristic annotation: `maker 'heuristic'`, `source 'heuristic'`, `raw_confidence NULL`, `reason 'heuristic'`. This holds whether or not the item was routed.
  - **Maker row:** written for every routed consult, with `maker = result.maker ?? --maker ?? 'default'`, `raw_value = String(result.value)` (the answer verbatim, before vocabulary mapping), `raw_confidence = result.confidence`, `reason = result.reason`, `duration_ms = result.durationMs`.
    - An accepted, in-vocabulary model answer gets `source 'model'` and the mapped value.
    - An out-of-vocabulary answer or spur's `source: default` gets `source 'default'`; its value is the heuristic or the catalog fallback, as today.
    - A spawn failure (`result === undefined`) writes no maker row.
  - **Every row:** `catalog_version`, the item's current `content_hash`, and `run_id = --run`.
  - **Report:** the `{labeled, model, fallback, consults, consultMs}` counters keep their meaning, with `fallback` = `source 'default'` rows.
- [ ] R3. Add `readStoreConfig(configFile?)` to `packages/kk-store/src/config.ts`. It returns a typed `StoreConfig { dbPath?, labels: { priority, decisionPriority, minConfidence } }`, and `readStoreDbPath` is reimplemented on top of it.
  - Keys:
    - `store.labels.priority: string[]` (default `['*', 'heuristic']`);
    - `store.labels.decisions.<id>.priority: string[]` (optional, replaces the global list for that decision);
    - `store.labels.min_confidence: number in [0,1]` (default `0.8`).
  - A missing or unparseable file yields the defaults (zero-config).
  - A present key with the wrong type or an out-of-range value throws `StoreConfigInvalidError`, naming the key. A silently defaulted threshold would change the pool.
  - 0227 and 0229 extend this same function.
- [ ] R4. One CTE builder, `labelsCurrentSql(policy)` in `packages/kk-store/src/dao/labels.ts`, feeds `ItemsDao.selectByProfile` joins, `ItemsDao.labelsFor` and `LabelsDao.currentFor(itemIds, policy)`. For each `(item_id, decision_id)` it keeps a row when all of these hold:
  - the row's `content_hash` equals the item's current hash;
  - `source` is not `'default'`;
  - for a `source 'model'` row, `raw_confidence >= min_confidence`;
  - its maker is listed in the effective priority, or is matched by `'*'`;
  - for a `run_id` starting `replay-`, its maker is listed **by name**; `'*'` never admits a replay row.

  Kept rows are ranked by priority position (`'*'` takes its own position) and ties go to the latest `labeled_at`, then the greatest `run_id`. Row number 1 wins. `kk store extract` reads labels only through it.
- [ ] R5. The enum `confidence` column and the verdict line keep G31 R14 behaviour unchanged: `labelConfidence(source, raw_confidence)`. `min_confidence` affects only R4 eligibility.
- [ ] R6. `kk store label --replay <selector> --maker <name> [--decisions <ids>]`:
  - **Selector:** exactly one of `topic:<profile>` (the profile's `where`/window pool, with no exclusion), `run:<collect-run-id>` (items whose `first_seen_run` or `last_seen_run` equals it) or `since:<n><s|m|h|d>` (`first_seen_at` within the window, via `parseWindow`).
  - **Flags:** `--replay` is mutually exclusive with `--new-ids`, and `--maker` is required with it. Either violation exits nonzero.
  - **Behaviour:** every selected item is routed in decision mode to that maker for the selected decisions (default: all catalog decisions). Only maker rows are written (no heuristic rows), under run id `replay-<epoch-ms>`.
  - **Output:** prints `{replayed, consults, consultMs, run}`. A selector matching 0 items prints `replayed: 0` and exits 0.
- [ ] R7. In the same commit, `docs/04_DESIGN.md` documents `--replay` and the `store.labels.*` keys.

### Acceptance Criteria

- [ ] AC1 — A model answer is stored raw even below the confidence threshold
- [ ] AC2 — The current label follows maker priority and the kk threshold
- [ ] AC3 — Replay re-labels a historical pool without disturbing production selection

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T02:37:55.636Z

- **Q: What does the kk threshold do to the enum level?** Nothing (refine audit). Closed: the enum keeps G31 R14 mapping; `min_confidence` gates only `labels_current`.
- **Q: How is a replay kept out of production?** Closed: a `replay-*` row is eligible only when its maker is listed by name. `'*'` never admits one, and unlisted makers are excluded, not ranked last.
- **Q: Should a routed item keep its heuristic row?** Yes. Closed: it is the baseline maker every backtest compares against.
- **Q: How are config errors handled?** Closed: a missing file uses defaults; a malformed present key fails loud.

### Design

**Frozen names**:

| Kind | Names |
|---|---|
| Config API | `readStoreConfig`, `StoreConfig`, `StoreConfigInvalidError` (`kk-store/src/config.ts`) |
| CTE | `labelsCurrentSql(policy): { sql, params }` and `LabelPolicy { priority, decisionPriority, minConfidence }` (`dao/labels.ts`) |
| DAO | `LabelsDao.currentFor(itemIds, policy)` |
| Replay | run-id prefix `replay-`; selector prefixes `topic:` / `run:` / `since:` |
| Wildcard | `'*'` |

**CTE shape**:

```sql
WITH lc AS (
  SELECT l.*, ROW_NUMBER() OVER (
    PARTITION BY l.item_id, l.decision_id
    ORDER BY <prio CASE>, l.labeled_at DESC, l.run_id DESC) AS rn
  FROM labels l JOIN items it ON it.id = l.item_id AND it.content_hash = l.content_hash
  WHERE <eligibility>)
SELECT … FROM lc WHERE rn = 1
```

- The priority `CASE` is built per decision: `CASE WHEN l.decision_id = ? THEN (CASE l.maker WHEN ? THEN 0 … END) … ELSE (global CASE) END`.
- A maker matched only by `'*'` gets the `'*'` position. An unmatched maker is filtered out in `WHERE`, not ranked last.
- bun:sqlite ships SQLite ≥ 3.25, so window functions are available.

**Other decisions**:

- `selectByProfile` swaps `labels <alias>` for a `labels_current` CTE alias. The JOIN-vs-LEFT-JOIN semantics are unchanged: a `where` decision with no current row still excludes the item, which is fail-closed.
- The threshold now lives in kk config, so it can be re-tuned offline. Changing `min_confidence` re-ranks history with no new model calls.

**Anti-patterns**:

- Mapping the enum against `min_confidence`.
- A SQL VIEW.
- Ranking unlisted makers last instead of excluding them.
- Letting `'*'` admit `replay-*` rows.
- Overwriting or deleting other makers' rows during replay.
- A second config reader beside `readStoreConfig`.

**Handoffs**:

- **0227** adds `story` keys to `StoreConfig`.
- **0229** adds `china_politics_terms` and relies on R4's fail-closed JOIN for its profile gate.
- **0230** sets a live `store.labels.priority` in the operator config and runs one replay.

### Plan

1. Write the failure-first list: an unlisted maker; a tie on `labeled_at`; a stale content hash; a below-threshold model answer with no heuristic row; an empty priority list; a replay selector matching 0 items; mutually exclusive selectors.
2. Make the catalog change and the config keys.
3. Change the label-row mapping in `store.ts` to raw capture.
4. Build the `labels_current` CTE and switch the profile compiler to it.
5. Add `--replay` and its selector parsing.
6. Update 04 and run `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G32 (R3, R4, R5). Brainstorm D1, D6, D7, D8. Depends on 0225 (`recordObservation`, `content_hash` column).
- `apps/cli/src/commands/store.ts:328-336` (DecisionResult), `:590-625` (labelRow), `:641-685` (labelItem), `:715-775` (labelAction write loop), `:1010-1028` (label command).
- `packages/kk-store/src/dao/labels.ts:38-43` (labelConfidence), `dao/items.ts:235-306` (selectByProfile), `:309-323` (labelsFor), `src/config.ts:26-58`, `src/profile.ts:20` (ITEM_DECISION_IDS).
- `plugins/kk/decisions/kk-items.yaml:13,18`. Catalog schema range: `@gobing-ai/spur/schemas/decision-catalog.schema.json`.

### History

- 2026-10-09T02:45:14.497Z backlog → todo (system)

