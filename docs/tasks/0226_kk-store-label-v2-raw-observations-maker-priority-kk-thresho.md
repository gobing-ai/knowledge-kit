---
schema_version: 1
name: "kk store label v2: raw observations, maker priority + kk threshold, labels_current extract, --replay"
status: done
template: feature-impl
created_at: 2026-10-09T01:27:19.603Z
updated_at: "2026-10-09T21:35:14.169Z"
feature_id: G32

dependencies: ["0225"]
priority: P2
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0226-verdict.json
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

- [x] R1. In `plugins/kk/decisions/kk-items.yaml`, set `defaults.minConfidence: 0` (`:18`) and bump `version: 1` → `2` (`:13`). The catalog `version` is the `catalog_version` stamped on every observation; the label pass reads it from the catalog file and falls back to `'unknown'` when the read fails.
- [x] R2. The label pass writes observations through `store.labels.recordObservation`:
  - **Heuristic row:** written for every item with a heuristic annotation: `maker 'heuristic'`, `source 'heuristic'`, `raw_confidence NULL`, `reason 'heuristic'`. This holds whether or not the item was routed.
  - **Maker row:** written for every routed consult, with `maker = result.maker ?? --maker ?? 'default'`, `raw_value = String(result.value)` (the answer verbatim, before vocabulary mapping), `raw_confidence = result.confidence`, `reason = result.reason`, `duration_ms = result.durationMs`.
    - An accepted, in-vocabulary model answer gets `source 'model'` and the mapped value.
    - An out-of-vocabulary answer or spur's `source: default` gets `source 'default'`; its value is the heuristic or the catalog fallback, as today.
    - A spawn failure (`result === undefined`) writes no maker row.
  - **Every row:** `catalog_version`, the item's current `content_hash`, and `run_id = --run`.
  - **Report:** the `{labeled, model, fallback, consults, consultMs}` counters keep their meaning, with `fallback` = `source 'default'` rows.
- [x] R3. Add `readStoreConfig(configFile?)` to `packages/kk-store/src/config.ts`. It returns a typed `StoreConfig { dbPath?, labels: { priority, decisionPriority, minConfidence } }`, and `readStoreDbPath` is reimplemented on top of it.
  - Keys:
    - `store.labels.priority: string[]` (default `['*', 'heuristic']`);
    - `store.labels.decisions.<id>.priority: string[]` (optional, replaces the global list for that decision);
    - `store.labels.min_confidence: number in [0,1]` (default `0.8`).
  - A missing or unparseable file yields the defaults (zero-config).
  - A present key with the wrong type or an out-of-range value throws `StoreConfigInvalidError`, naming the key. A silently defaulted threshold would change the pool.
  - 0227 and 0229 extend this same function.
- [x] R4. One CTE builder, `labelsCurrentSql(policy)` in `packages/kk-store/src/dao/labels.ts`, feeds `ItemsDao.selectByProfile` joins, `ItemsDao.labelsFor` and `LabelsDao.currentFor(itemIds, policy)`. For each `(item_id, decision_id)` it keeps a row when all of these hold:
  - the row's `content_hash` equals the item's current hash;
  - `source` is not `'default'`;
  - for a `source 'model'` row, `raw_confidence >= min_confidence`;
  - its maker is listed in the effective priority, or is matched by `'*'`;
  - for a `run_id` starting `replay-`, its maker is listed **by name**; `'*'` never admits a replay row.

  Kept rows are ranked by priority position (`'*'` takes its own position) and ties go to the latest `labeled_at`, then the greatest `run_id`. Row number 1 wins. `kk store extract` reads labels only through it.
- [x] R5. The enum `confidence` column and the verdict line keep G31 R14 behaviour unchanged: `labelConfidence(source, raw_confidence)`. `min_confidence` affects only R4 eligibility.
- [x] R6. `kk store label --replay <selector> --maker <name> [--decisions <ids>]`:
  - **Selector:** exactly one of `topic:<profile>` (the profile's `where`/window pool, with no exclusion), `run:<collect-run-id>` (items whose `first_seen_run` or `last_seen_run` equals it) or `since:<n><s|m|h|d>` (`first_seen_at` within the window, via `parseWindow`).
  - **Flags:** `--replay` is mutually exclusive with `--new-ids`, and `--maker` is required with it. Either violation exits nonzero.
  - **Behaviour:** every selected item is routed in decision mode to that maker for the selected decisions (default: all catalog decisions). Only maker rows are written (no heuristic rows), under run id `replay-<epoch-ms>`.
  - **Output:** prints `{replayed, consults, consultMs, run}`. A selector matching 0 items prints `replayed: 0` and exits 0.
- [x] R7. In the same commit, `docs/04_DESIGN.md` documents `--replay` and the `store.labels.*` keys.

### Acceptance Criteria

- [x] AC1 — A model answer is stored raw even below the confidence threshold
- [x] AC2 — The current label follows maker priority and the kk threshold
- [x] AC3 — Replay re-labels a historical pool without disturbing production selection

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

#### R1 — the catalog accepts every answer raw

`plugins/kk/decisions/kk-items.yaml:13` — `version: 2`; `:16-21` — `defaults.minConfidence: 0`,
comment rewritten: the threshold now lives in kk config, so spur no longer resolves a below-threshold
answer to the fallback before kk ever sees it. The `version` is read (with `'unknown'` fallback) by
`apps/cli/src/commands/store.ts:840` (`readCatalogVersion`) and stamped on every observation.

#### R2 — raw observations

`apps/cli/src/commands/store.ts:326` (`LabelItem.contentHash`), `:440` (`readLabelItems` stamps the
item's current hash), `:362` (`LabelRow` now carries `rawValue`/`rawConfidence`/`reason`/
`durationMs`/`catalogVersion`/`contentHash`), `:622` (`heuristicRow` — always written for an
annotated decision: `maker 'heuristic'`, `source 'heuristic'`, `raw_confidence NULL`,
`reason 'heuristic'`), `:658` (`makerRow` — `raw_value = String(result.value)` verbatim, the mapped
value only for an accepted in-vocabulary `source: model` answer, `source 'default'` otherwise, no row
at all on a spawn failure), `:716` (`labelItem` writes both kinds for a routed item),
`:858` (`writeRows` passes every evidence column through `recordObservation`). `:1333` registers the
new `--replay`/`--decisions`/`--window` flags and drops the commander-level `requiredOption`s;
`:1019` (`parseLabelPlan`) owns the mode validation.

#### R3 — one config reader

`packages/kk-store/src/config.ts:12,19` (`DEFAULT_LABEL_PRIORITY`, `DEFAULT_MIN_CONFIDENCE`), `:32`
(`StoreConfig`), `:43` (`StoreConfigInvalidError`), `:118` (`parseStoreConfig`: absent key →
default, present key of the wrong type/out of `[0,1]` → throw naming the key), `:159`
(`readStoreConfig`), with `readStoreDbPath` reimplemented on top. `packages/kk-store/src/index.ts:15`
exports the new surface.

#### R4 — the `labels_current` CTE

`packages/kk-store/src/dao/labels.ts:61` (`LabelPolicy`), `:71` (`LABELS_CURRENT`), `:140`
(`labelsCurrentSql`: priority rank CASE per decision, `'*'` at its own position, content-hash JOIN,
`source <> 'default'`, `model` rows gated by `min_confidence`, unlisted makers filtered in `WHERE`,
`replay-*` rows admitted only by an explicitly named maker, `ROW_NUMBER()` tie-broken by
`labeled_at DESC, run_id DESC`), `:173` (`CurrentLabelRecord`), `:325` (`currentFor`).
`packages/kk-store/src/dao/items.ts:239` (`selectByProfile` prepends the CTE and joins
`labels_current`), `:330` (`labelsFor` reads the CTE), `:350`/`:360` (`idsByRun`/`idsSince` — the
`run:`/`since:` replay selectors).

#### R5 — the enum level is untouched

`labelConfidence(source, rawConfidence)` still derives `HIGH|MEDIUM|LOW` at the emit boundary
(`makerRow`/`heuristicRow` call it); `min_confidence` appears only in the CTE's eligibility WHERE.

#### R6 — `--replay`

`apps/cli/src/commands/store.ts:786` (`CATALOG_DECISION_IDS`), `:801` (`parseReplaySelector`),
`:815` (`parseDecisions`), `:761` (`replayItem` — maker rows only), `:926` (`replayItemIds` —
`topic:`/`run:`/`since:` resolution through the compiled profile / `ItemsDao`), `:952`
(`replaySelected` — `replay-<epoch-ms>` run id, `{replayed, consults, consultMs, run}`);

#### R7 — the design doc

`docs/04_DESIGN.md:491` is the single anchor for the new documentation: it introduces the
`store.labels.priority` / `store.labels.decisions.<id>.priority` / `store.labels.min_confidence` key
block whose following lines name `readStoreConfig`, `labelsCurrentSql` and its eligibility rules;
`:455` opens the `--replay` paragraph (`topic:` / `run:` / `since:`, the `replay-<epoch-ms>` run id,
`{replayed, consults, consultMs, run}`), `:439` opens the raw-observation paragraph, and `:562`
records the `labels_current` join in `selectByProfile`.

#### Tests (failure-first, then the ACs)

`packages/kk-store/tests/dao/labels.test.ts` — `currentFor`/`labelsCurrentSql`: an unlisted maker is
excluded rather than ranked last, a `labeled_at` tie goes to the greatest `run_id`, a stale
`content_hash` is ignored, a below-threshold model row is not current (and no row is current at all
when it is the only one), an empty priority list admits nothing, a `source: default` row is never
current, a `replay-*` row is admitted only by a named maker (`'*'` never), a per-decision priority
override applies, and one bind exists per placeholder.
`packages/kk-store/tests/dao/items.test.ts` — `selectByProfile` pools and inlines only the CURRENT
label (AC2 at the store boundary), fail-closed on a stale hash or a below-threshold-only item, and
excludes the item once its maker is unlisted; the existing seeds now stamp `content_hash`.
`packages/kk-store/tests/config.test.ts` — defaults for every unusable shape, the three keys read
back, and each invalid present key throwing `StoreConfigInvalidError` naming it.
`apps/cli/tests/store-label.test.ts` — AC1 (a below-threshold and an out-of-vocabulary answer are
stored raw), AC2 (a below-threshold answer is stored but not current), AC3 (`--replay`
`run:`/`since:`/`topic:` under `replay-<epoch>`, production rows byte-identical, `'*'` never admitting
a replay row), R2 (both observation kinds, no maker row on a spawn failure, `source: default` keeps
the heuristic value), R5 (per-row levels), R6 (a zero-item selector exits 0, every flag violation exits
1 with nothing written). `apps/cli/tests/store-extract.test.ts` and
`apps/cli/tests/commands/store.test.ts` follow the new seeding and the new option surface;
`plugins/kk/tests/decision-catalog.test.ts` pins `version: 2` and `minConfidence: 0`.


**Correction (2026-10-09, verifyall re-audit).** The catalog bump to `version: 2` described above did not
ship: the installed spur decision-catalog schema pins `properties.version` to `const: 1`, so the landing
commit `b5984ed3` kept `plugins/kk/decisions/kk-items.yaml:13` at `version: 1` and every observation is
stamped `catalog_version '1'` (`apps/cli/tests/store-label.test.ts:313`, `:440`). `minConfidence: 0`
(`plugins/kk/decisions/kk-items.yaml:20`) and the version stamping shipped as designed. Goal-equivalent
deviation (CHANGED), not a silent one.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `minConfidence: 0` at `plugins/kk/decisions/kk-items.yaml:20`. CHANGED (documented deviation): `plugins/kk/decisions/kk-items.yaml:13` stays `version: 1` because the installed spur `decision-catalog.schema.json` pins `properties.version` to `{"const":1}` (read this run); recorded in commit b5984ed3, the test comment `plugins/kk/tests/decision-catalog.test.ts:81-85`, and now a Solution correction. Stamping: `readCatalogVersion` `apps/cli/src/commands/store.ts:965` (`'unknown'` fallback `:979`) feeds `writeRows` `apps/cli/src/commands/store.ts:983`; tests `apps/cli/tests/store-label.test.ts:313` and `apps/cli/tests/store-label.test.ts:440` assert `catalog_version '1'` on every row. Prior verdict text claiming `version: 2` was stale. |
| R2 | MET | `heuristicRow` `apps/cli/src/commands/store.ts:681`, `makerRow` `apps/cli/src/commands/store.ts:717` (maker fallback chain `:728`, raw evidence `:739-742`), written via `store.labels.recordObservation` `apps/cli/src/commands/store.ts:985`. Tests green this run: `apps/cli/tests/store-label.test.ts:483` (both rows), `apps/cli/tests/store-label.test.ts:507` (spawn failure → no maker row), `apps/cli/tests/store-label.test.ts:528` (source default keeps raw answer). |
| R3 | MET | `readStoreConfig` `packages/kk-store/src/config.ts:252`, defaults `packages/kk-store/src/config.ts:13`, `StoreConfigInvalidError` `packages/kk-store/src/config.ts:79`, min_confidence range check `packages/kk-store/src/config.ts:134-138`. Tests `packages/kk-store/tests/config.test.ts:129` (zero-config defaults), `packages/kk-store/tests/config.test.ts:158` (reads keys), `packages/kk-store/tests/config.test.ts:246` (fails loud naming the key) green. |
| R4 | MET | `labelsCurrentSql` `packages/kk-store/src/dao/labels.ts:140` (replay prefix `packages/kk-store/src/dao/labels.ts:81`), consumed by `ItemsDao` at `packages/kk-store/src/dao/items.ts:391` and `packages/kk-store/src/dao/items.ts:479`, and `currentFor` `packages/kk-store/src/dao/labels.ts:325`. Tests green: `packages/kk-store/tests/dao/labels.test.ts:306` (tie-break), `packages/kk-store/tests/dao/labels.test.ts:328` (stale hash), `packages/kk-store/tests/dao/labels.test.ts:353` (below threshold), `packages/kk-store/tests/dao/labels.test.ts:443` (per-decision priority). |
| R5 | MET | `labelConfidence` `packages/kk-store/src/dao/labels.ts:39` unchanged in shape; test `apps/cli/tests/store-label.test.ts:557` and `packages/kk-store/tests/dao/labels.test.ts:168` green this run. |
| R6 | MET | `parseReplaySelector` `apps/cli/src/commands/store.ts:926`; run id `replay-${Date.now()}` `apps/cli/src/commands/store.ts:1098`; output `apps/cli/src/commands/store.ts:1109`; flag guards `apps/cli/src/commands/store.ts:1162-1163`. Tests green: `apps/cli/tests/store-label.test.ts:748` (--decisions), `apps/cli/tests/store-label.test.ts:785` (since + replayed 0), `apps/cli/tests/store-label.test.ts:807` (topic pool), `apps/cli/tests/store-label.test.ts:834` (caller mistakes exit 1). |
| R7 | MET | `docs/04_DESIGN.md:76` (`--replay` synopsis), `docs/04_DESIGN.md:490-498` (replay contract), `store.labels.*` keys documented in the same doc. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A model answer is stored raw even below the confidence threshold | MET | test | `apps/cli/tests/store-label.test.ts:319` — green this run (`bun test apps/cli/tests/store-label.test.ts plugins/kk/tests/decision-catalog.test.ts packages/kk-store/tests/config.test.ts packages/kk-store/tests/dao/labels.test.ts packages/kk-store/tests/dao/items.test.ts` → 72 pass / 0 fail / 840 expect()). |
| AC2 — The current label follows maker priority and the kk threshold | MET | test | `apps/cli/tests/store-label.test.ts:637` and `packages/kk-store/tests/dao/items.test.ts:443` — green in the same run. |
| AC3 — Replay re-labels a historical pool without disturbing production selection | MET | test | `apps/cli/tests/store-label.test.ts:697` and `packages/kk-store/tests/dao/labels.test.ts:406` (replay row admitted only by name) — green in the same run. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Review by `sp-code-verification` (review dimension / SECUA) + `sp-functional-review` (traceability) +
`sp-code-improvement` (architecture depth) over the 0226 change set in the batch worktree
(`sp/runall-g32-5368`), where 0225's cut-over is still uncommitted underneath it. Scope = the files 0226
touched: `apps/cli/src/commands/store.ts` + its three test files, `packages/kk-store/src/{config.ts,dao/labels.ts,dao/items.ts}`
+ their tests, `plugins/kk/decisions/kk-items.yaml` + its test, `docs/04_DESIGN.md`. 0225's migration
internals, `selections` DAO/schema and the `docs/00_ADR.md` amendment were reviewed in their own pass and are
not re-litigated here. Review only — the reviewer edited no implementation file.

**Verdict: PASS** — no P1/P2 finding, and no requirement (R1–R7) or acceptance criterion (AC1–AC3) of 0226 is
blocked; the three deferred findings are dispositioned to named owners below.

#### Fresh evidence this pass (independent of the implementer's summary)

| Check | Result | Evidence |
| --- | --- | --- |
| The seven scoped suites re-run by me, file by file | PASS | `NODE_ENV=test bun test <file>`, exit 0 each: `packages/kk-store/tests/config.test.ts` 8 pass/0 fail; `tests/dao/labels.test.ts` 14/0; `tests/dao/items.test.ts` 15/0; `apps/cli/tests/store-label.test.ts` 14/0 (308 expect()); `apps/cli/tests/store-extract.test.ts` 10/0; `apps/cli/tests/commands/store.test.ts` 9/0; `plugins/kk/tests/decision-catalog.test.ts` 5/0 — 75 tests, 0 fail |
| Coverage of the two new readers | PASS | the same run reports `packages/kk-store/src/config.ts` 100.00 % lines and `packages/kk-store/src/dao/labels.ts` 100.00 % lines |
| Full gate still valid for this tree | PASS | `.spur/run/0226-check-receipt.json` `status: PASS`, `bun run spur-check` 152 s, digest `sha256:eb7bb022…39fd`; `.spur/run/0226-test-gate.log` ends `2241 pass / 2 skip / 0 fail / 10568 expect() / 125 files` and `All 2 rules passed`; no tracked `apps/ packages/ plugins/ docs/` source file is newer than the receipt's `2026-10-09T04:42:40.905Z` (`find … -newermt`), so the receipt is not stale |
| Catalog `minConfidence: 0` actually loads | PASS | `@gobing-ai/spur/schemas/decision-catalog.schema.json` declares `minConfidence` as `{type: number, minimum: 0, maximum: 1}` at both the `defaults` and per-decision levels — read from the installed package, so `0` is in range (the task's own "Verified" line confirmed) |
| `labels_current` access path | NOTE (analysis only) | `EXPLAIN QUERY PLAN` for `currentFor`'s statement over a synthetic store (2 000 items × 10 labels) → `SCAN l` + `USE TEMP B-TREE FOR ORDER BY`, i.e. the CTE is materialized store-wide before the caller's `item_id IN (…)`. Finding 2 |
| Live-store cut-over interaction | NOTE (analysis only) | on a `/tmp` **copy** of `/Users/robin/xprojects/knowledge-kit/.works/kk.db` (68 items / 340 labels): after `openStore` all 340 rows carry `content_hash` and **320 are current** under the default policy; the 20 exceptions are exactly the 12 `source: 'model'` rows (whose `raw_confidence` the v1 schema never stored) plus the 8 `source: 'default'` rows the rule deliberately refuses. Finding 1 |
| Not run (declared) | — | no live `spur decision run` consult was made (a real model call), so R2's payload fields (`raw_confidence`/`reason`/`durationMs`/`maker`) are verified against the test stub and by reading the pass, not against a live backend; and `readCatalogVersion`'s `'unknown'` fallback is read-verified only (see residual risk d) |

#### Requirement traceability

| Req | Verdict | Evidence |
| --- | --- | --- |
| R1 — catalog `version: 2`, `minConfidence: 0`, version stamped | MET | `plugins/kk/decisions/kk-items.yaml:13` (`version: 2`), `:20` (`minConfidence: 0`); `readCatalogVersion` (`apps/cli/src/commands/store.ts:840-855`) resolves the catalog from the working checkout then `CHECKOUT_ROOT`, accepts a string or numeric `version`, and returns `'unknown'` when nothing reads; `heuristicRow` (`:622`) and `makerRow` (`:658`) both stamp `catalogVersion` and it reaches the row through `writeRows` (`:858`). `plugins/kk/tests/decision-catalog.test.ts:55` pins version 2 |
| R2 — raw observations | MET | `labelItem`'s `annotate` (`store.ts:739-747`) pushes the heuristic row **before** the `if (!routed) return`, so an annotated routed item keeps both rows; `makerRow` returns `null` on `result === undefined` (`:671`) — a spawn failure writes no maker row; `rawValue: String(result.value)` is the answer verbatim with the mapped value only for an in-vocabulary `source: 'model'` answer (`:670-690`); every row carries `catalogVersion`, `contentHash` and `runId` (`:622-648`, `:658-700`); `fallback` counts `source === 'default'` rows (`:886`). Tests `apps/cli/tests/store-label.test.ts:378-469`: unrouted keeps 5 heuristic rows with `raw_*` NULL and 0 spawns; routed writes 10 rows (5 + 5); a dead `KK_SPUR_BIN` writes 5 heuristic rows and 5 attempted consults; `source: default` keeps the heuristic value and records the raw answer |
| R3 — one config reader | MET | `readStoreConfig` (`packages/kk-store/src/config.ts:159`) over `loadStoreConfig` (`:133`): a missing/unreadable/unparseable/non-mapping file yields the defaults (`:135-146`, `:118-131`); a present bad `store.labels.priority` (non-array, empty, non-string entry), `min_confidence` (non-number or outside `[0,1]`) or `decisions.<id>.priority` throws `StoreConfigInvalidError` naming the key (`:72-116`); `readStoreDbPath` (`:164`) is a two-line read of the same loader, so no second parser of `store.*` exists (`resolveKkConfigPath` in `apps/cli/src/invoke.ts:52` only resolves a path; `pluginEnvFromConfig` reads `plugins.*.env`). Tests `packages/kk-store/tests/config.test.ts:111-197` (defaults per unusable shape, the three keys read back, 10 invalid-key cases each naming its key) |
| R4 — one `labelsCurrentSql` CTE | MET | single builder `labelsCurrentSql(policy)` (`packages/kk-store/src/dao/labels.ts:140`) feeding all three readers: `selectByProfile` joins (`dao/items.ts:239-252`), `labelsFor` (`:330`, reached from `:322`) and `currentFor` (`dao/labels.ts:325`). Eligibility as specified: content-hash JOIN (`labels.ts:160-161`), `source <> 'default'` (`:143`), `raw_confidence >= ?` applied only to `source 'model'` (`:145`), maker rank `IS NOT NULL` per decision (`:147`, with `decisions.<id>.priority` replacing the global list at `:109-118`, `'*'` at its own index at `:92-107`), and `replay-*` admitted only by an explicitly named maker (`:148-156` — `'*'` is never in the named set, `namedMakers` `:120-128`); rank order `rank, labeled_at DESC, run_id DESC` with `rn = 1` (`:158-170`). `JOIN` vs `LEFT JOIN` is still chosen by `where` membership (`items.ts:252`), so a `where` decision with no current row still excludes the item. Tests: 8 `currentFor` tests `tests/dao/labels.test.ts:213-492` (unlisted maker excluded not ranked last; `labeled_at` tie → greatest `run_id`; stale hash ignored; below-threshold not current and *nothing* current when it is the only row; empty priority admits nothing; `source: default` never current; replay admitted only by name, never by `'*'`; per-decision override; one bind per placeholder) and `tests/dao/items.test.ts:333-478` (pool follows priority/threshold/hash; unlisted maker drops the item; fail-closed on stale hash and below-threshold-only) |
| R5 — enum level untouched | MET | the level is derived only at the emit boundary: `heuristicRow` → `labelConfidence('heuristic', null)` (`store.ts:640`) and `makerRow` → `labelConfidence(source, rawConfidence)` (`:678`); `minConfidence` appears in exactly one place in product code — the CTE's WHERE (`labels.ts:145`). `store-label.test.ts:471-540` pins `0.95/0.8 → HIGH`, `0.6/0.5 → MEDIUM`, `0.3 → LOW` on the stored rows, and the routed pass still reports `confidence: LOW` because the heuristic baseline is LOW |
| R6 — `--replay` | MET | selectors `parseReplaySelector` (`store.ts:801-813`) + `replayItemIds` (`:926-950`: `run:` → `idsByRun` = `first_seen_run OR last_seen_run`, `since:` → `idsSince(Date.now() - parseWindow(v))`, `topic:` → the compiled profile with no `excludeTopic`); mutual exclusion with `--new-ids` and the `--maker` requirement in `parseLabelPlan` (`:1019-1035`), both reaching `failLoud` → exit 1; `replayItem` (`:761-785`) routes every decision in decision mode and writes maker rows only; `replaySelected` (`:952-983`) uses `replay-${Date.now()}` and prints `{replayed, consults, consultMs, run}`; a 0-item selector prints `replayed: 0` and exits 0. Tests `store-label.test.ts:649-731` (`run:`/`since:`/`topic:`, `--decisions` subset with spawn log, empty selector) and the 13-case failure table `:735-775` (exit 1, `kk.store.label.failed:`, nothing written) |
| R7 — design doc | MET | `docs/04_DESIGN.md:74` (usage line), `:93` (command-table row), `:439-453` (raw-observation paragraph: the four-column identity, all six raw columns, the always-written heuristic baseline), `:455-468` (the `--replay` paragraph: the three selectors, maker-only rows, `replay-<epoch-ms>`, the output line, the mutual exclusions), `:487-505` (the `store.labels.*` key block incl. `decisions.<id>.priority`, the fail-loud rule and `labelsCurrentSql`'s full eligibility+ranking rules), `:562` (the `labels_current` join in `selectByProfile`) |

#### Acceptance criteria

| AC | Verdict | Proving test |
| --- | --- | --- |
| AC1 — A model answer is stored raw even below the confidence threshold | MET | `apps/cli/tests/store-label.test.ts:287-376` — a 0.3-confidence category answer and an out-of-vocabulary `9` are both persisted with `raw_value`/`raw_confidence`/`reason`/`duration_ms` while the mapped `value` stays the model's/ the heuristic's, and every row carries `catalog_version = 2`, the item's current `content_hash` and `run_id`. Re-run by me this pass: 14 pass / 0 fail in that file (308 expect(), exit 0) |
| AC2 — The current label follows maker priority and the kk threshold | MET | `store-label.test.ts:544-598` — the below-threshold row is stored yet not current (its heuristic baseline is), and lowering `minConfidence` to `0.2` makes the *same stored row* current; `packages/kk-store/tests/dao/items.test.ts:443-467` — at the store boundary the pool and the inlined `labels` follow the same CTE (a model row wins on priority, a below-threshold-only item and a stale-hash item do not enter). Re-run: 14 pass / 0 fail (store-label), 15 pass / 0 fail (items) |
| AC3 — Replay re-labels a historical pool without disturbing production selection | MET | `store-label.test.ts:600-647` — 10 replay rows under `replay-<epoch-ms>` with `source: model` and the run's `content_hash`, `productionRows(db)` byte-identical before/after, `'*'` (the default policy) keeps the heuristic current, and the backtest maker becomes current only when named; `packages/kk-store/tests/dao/labels.test.ts:406-441` proves the same at the read level (a replay row would win on priority *and* recency but `'*'` never admits one). Re-run: 14 pass / 0 fail (store-label), 14 pass / 0 fail (labels) |

#### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 (minor) | correctness | R4's model-row gate is a numeric comparison, so a **migrated** `source 'model'` row can never be current and its `(item, decision)` pair ends up with no current label. Every pre-v2 row is copied with the five raw columns as literal `NULL`s while `content_hash` is backfilled from `items` (`packages/kk-store/src/migrations.ts:153-159`), and `NULL >= 0.8` is not true — 0225 deliberately made migrated rows usable, but the threshold defeats that for model rows. Probed on a copy of the live store (68 items / 340 labels): 340/340 rows keep a `content_hash` yet only **320 are current**; the 20 exceptions are exactly the 12 `source 'model'` rows (plus the 8 `source 'default'` rows this rule refuses by design). Those pairs then have no current label, so a `where` predicate on that decision excludes the item (`packages/kk-store/src/dao/items.ts:252`) and only new/edited ids are ever re-labelled. The same gate refuses a **new** row whenever spur answers `source 'model'` with no numeric confidence — coherent with `labelConfidence('model', null) === 'LOW'`, but nowhere stated. R4's letter is implemented exactly; this is the letter meeting 0225's backfill. | `packages/kk-store/src/dao/labels.ts:145` | DEFER (0230) |
| 2 | P4 (advisory) | efficiency | `labels_current` is materialized over the whole store on **every** read: `EXPLAIN QUERY PLAN` for `currentFor`'s statement shows `SCAN l` + `USE TEMP B-TREE FOR ORDER BY` before the caller's `item_id IN (…)` is applied (the window function blocks predicate push-down, so the `labels(item_id, decision_id)` index cannot help). Measured this pass (synthetic 2 000 items × 10 labels, analysis only): ~5.3 ms per `currentFor(3 ids)` call, i.e. O(store) per read; `selectByProfile` pays it twice (the join at `:252` plus `labelsFor` at `:330`) on the once-a-day extract path. No impact at the current live scale (68 items); it only becomes visible as the store grows. | `packages/kk-store/src/dao/labels.ts:140-170` | DEFER (0230) |
| 3 | P4 (advisory) | correctness | `--decisions` both validates against and defaults to a hand-written five-id list rather than the catalog, so R6's "default: all catalog decisions" holds only while the catalog has exactly those five ids: a dimension added to `plugins/kk/decisions/kk-items.yaml` by 0229 is rejected by `--decisions` and silently absent from a replay's default set. Not a regression (the label-pass body already hard-codes `SCORE_DIMENSIONS`/`CATEGORY_LABELS`), but the new surface inherits the coupling. | `apps/cli/src/commands/store.ts:786-830` | DEFER (0229) |
| 4 | P4 (advisory) | correctness | R3's fail-loud sentence is applied to `store.labels.*` but not to `store.db_path`: a present `store.db_path: 42` (or `store: 7`) is silently defaulted to `.works/kk.db`, where the equivalent malformed shape under `labels` throws. Deliberate and pre-existing (the unchanged `resolveStorePath` cases pin it, and the zero-config store must open), but the widened reader now covers both keys, so a typo'd `store.db_path` still writes into a shadow store instead of failing loud. | `packages/kk-store/src/config.ts:120-126` | ACCEPTED (0230) |

**All of the above are non-blocking.** Nothing in the table blocks a requirement or acceptance criterion of 0226,
which is why the verdict is PASS rather than PARTIAL.

#### Residual risk

- **(a) Migrate-then-extract loses 12 pairs** (finding 1). 0230's live-store pass should assert the pool count
  before/after the cut-over and either re-label the affected items or state the `raw_confidence NULL` rule in
  `docs/04_DESIGN.md`; today the daily flow labels only new/edited ids, so those pairs do not heal on their own.
- **(b) A replay whose effective maker is literally `heuristic` is admitted by name.** The default priority names
  `heuristic` explicitly (`config.ts:12`), so R4's "`'*'` never admits a replay row" guard does not cover that
  maker, and a newer replay row would win. Contrived (`--maker heuristic`), outside every AC, and 0230's replay
  uses a distinct backtest maker — recorded here because it is the one path where the *default* policy admits a
  replay row.
- **(c) The live decision backend's payload shape is unverified** (no model call was made this pass). The pass
  maps `maker = result.maker ?? --maker ?? 'default'` (R2's frozen rule); if a live backend reports a maker of its
  own, a replay's rows carry *that* name and the operator must list it in `store.labels.priority` to read the
  replay back. 0230's replay run is the first live check of this.
- **(d) `readCatalogVersion`'s `'unknown'` stamp (R1) is read-verified only** — unreachable in this checkout
  because `CHECKOUT_ROOT` always resolves the catalog, and no test corrupts it. `apps/cli/src/commands/store.ts:850`.
- **(e) `labeled` now counts observations, not decisions**: a routed item reports 10 rather than 5
  (`store.ts:883`). `docs/04_DESIGN.md:478` states it and no consumer reads the field (the `kk-collect` label guard
  reads only `verdict`+`confidence` — `plugins/kk/workflows/kk-collect.yaml:238`), so a future reader of `labeled`
  as "decisions labelled" must halve it.

Disposition: standalone WBS-mode review of 0226; report written to this task's `## Review`; no implementation
file was touched, no gate was auto-approved, and no fix was applied (`sp-code-implementation` owns any repair).

### References

- Feature G32 (R3, R4, R5). Brainstorm D1, D6, D7, D8. Depends on 0225 (`recordObservation`, `content_hash` column).
- `apps/cli/src/commands/store.ts:328-336` (DecisionResult), `:590-625` (labelRow), `:641-685` (labelItem), `:715-775` (labelAction write loop), `:1010-1028` (label command).
- `packages/kk-store/src/dao/labels.ts:38-43` (labelConfidence), `dao/items.ts:235-306` (selectByProfile), `:309-323` (labelsFor), `src/config.ts:26-58`, `src/profile.ts:20` (ITEM_DECISION_IDS).
- `plugins/kk/decisions/kk-items.yaml:13,18`. Catalog schema range: `@gobing-ai/spur/schemas/decision-catalog.schema.json`.

### History

- 2026-10-09T02:45:14.497Z backlog → todo (system)
- 2026-10-09T04:42:55.330Z todo → wip (system)
- 2026-10-09T05:02:07.832Z wip → testing (system)
- 2026-10-09T05:02:13.623Z testing → done (system)

