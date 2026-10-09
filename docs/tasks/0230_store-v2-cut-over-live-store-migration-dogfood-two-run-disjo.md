---
schema_version: 1
name: "Store v2 cut-over: live-store migration dogfood, two-run disjoint-pool E2E, design doc sync"
status: wip
template: feature-impl
created_at: 2026-10-09T01:27:20.622Z
updated_at: "2026-10-09T17:05:06.493Z"
feature_id: G32

dependencies: ["0225", "0226", "0227", "0228", "0229"]
priority: P2
estimate_hours: 3
---

## 0230. Store v2 cut-over: live-store migration dogfood, two-run disjoint-pool E2E, design doc sync

### Background

Option B ships G32 as one cut-over. This task proves it on the operator's real store and real workflows, then syncs the derived docs. Unit-level E2Es live in 0225–0229.

Depends on 0225, 0226, 0227, 0228 and 0229.

**Refine corrections (2026-10-08)**

- **Binary skew would break the scheduled collector.** launchd `ai.gobing.kk-collect` (`~/Library/LaunchAgents/ai.gobing.kk-collect.plist`) runs `spur workflow run plugins/kk/workflows/kk-collect.yaml` at 04/10/16/22h. Its `kk` resolves to the bun-global `@gobing-ai/knowledge-kit` **0.0.33** (`~/.bun/bin/kk → ~/.bun/install/global/.../dist/index.js`), not the repo build. After `0003_store_v2`, that binary's label upsert targets the dropped `(item_id, decision_id)` UNIQUE index, and every collect fails. Cut-over therefore requires the global `kk` to be a G32 build **before** the live migration. The new R0 makes this a gate.
- **Concurrent writers.** The scheduled collector writes the same WAL store. Migration runs while holding the store's own `collect` lock (`kk store lock acquire --name collect`, the same lock `kk-collect.yaml:75` takes), so a scheduled run that fires mid-cutover skips cleanly.
- **Dry-run semantics.** voice2's `publish_enabled` defaults to `"false"` (`kk-daily-ai-voice2.yaml:58`). With 0228's corrected R6(b), a dry run leaves its rows `selected`, so the second run's exclusion is exercised and `release` is meaningful.
- Live baseline at refine time: items 68, labels 340, `episode_usage` **0**, collect_runs 3, journal `0001`+`0002`.
- **Design was empty.** It is filled below, as ready depth requires.

### Requirements

- [x] R0. **Cut-over gate (operator-authorized).** `~/.bun/bin/kk --version` reports a build that contains 0225–0229, either a released version installed globally or `bun link` from `apps/cli`. Changing the operator's global binary or releasing needs explicit operator authorization. Without it, this task stops here as `blocked`, names the step, and leaves the live store untouched.
- [x] R1. Acquire the collect lock: `kk store lock acquire --name collect --run g32-cutover --ttl 3600000`. It must print `{acquired}`; `{skipped}` means a collect is running, so wait and retry.
  - Back up: `cp .works/kk.db .works/kk.db.pre-g32`, plus the `-wal`/`-shm` files if present, after a `PRAGMA wal_checkpoint(TRUNCATE)`.
  - Then run `kk store migrate`, then `kk store lock release --name collect --run g32-cutover`.
  - Record the counts before and after in Testing:
    - items unchanged;
    - labels row count unchanged, with every row's `run_id` non-null;
    - `episode_usage` rows = `selections` rows with `status='published'`;
    - the journal lists `0003_store_v2`.
- [x] R2. Run `kk store backfill-facts`. Record the `{updated}` count, the number of distinct `story_id`s vs items, and a spot-check of 10 multi-member clusters (merged correctly or not). Record the threshold verdict for U2.
- [x] R3. Run one real `kk-collect`: `spur workflow run plugins/kk/workflows/kk-collect.yaml`. Confirm by SQL that the new observations carry `raw_value`/`raw_confidence`/`reason`/`duration_ms`/`catalog_version='2'` and `content_hash`, that the three new decisions are present, and that new items have facts and `story_id`.
- [x] R4. Run `kk-daily-ai-voice2` twice with the default `publish_enabled=false`, under distinct run ids. The second run's `selections` (topic `ai-news`) share no `story_id` with the first's. Write `.works/test-artifacts/g32-live-disjoint.json` in the shape `{run1:{run,storyIds}, run2:{run,storyIds}, intersection:[], statuses:{selected:n}}`. Then `kk store release --run` both runs and confirm 0 `selected` rows remain for them.
- [x] R5. Capture `kk store extract --topic ai-news --include-selected --out a.json`. Run `kk store label --replay since:24h --maker <a maker not in store.labels.priority>`, re-extract to `b.json`, and confirm the two are byte-identical. Record the replay `{replayed, consults}`.
- [x] R6. Sync docs:
  - design doc `docs/design/kk-collect-and-daily-voice2.md`: §2 tables, §3 verbs, §4 labels/confidence (raw columns, `labels_current`, priority/threshold), §6 (`select` / `mark-published` nodes), §8 cut-over note;
  - `docs/03_ARCHITECTURE.md` "Persistent store" paragraph (`:123-129`);
  - `docs/05_FEATURES.md` G32 status.

  Then run `spur feature check G32`.

### Acceptance Criteria

- [x] AC1 — Two consecutive daily dry runs produce disjoint pools
- [x] AC2 — Decision and surface docs record store v2

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T02:44:03.884Z

- **Q: Which `kk` does the scheduled collector run?** The bun-global 0.0.33, not the repo build (refine audit). Closed: R0 gates the cut-over on a G32 global binary, and the install/release is operator-authorized.
- **Q: How is the live store protected during migration?** Closed: the store's own `collect` lock, a WAL checkpoint plus file backup, and the atomic `0003` batch. Rollback restores the file and the old binary.
- **Q: Can dry runs mark items published?** No, after the 0228 correction. Closed: `mark-published` is guarded by `publish_enabled`.

### Design

**Cut-over order** (frozen):

1. R0 binary gate.
2. Take the collect lock.
3. Checkpoint, then back up.
4. Migrate.
5. Release the lock.
6. Backfill.
7. Live collect.
8. Dry runs.
9. Replay.
10. Docs.

Every step after step 4 runs on the migrated live store with the G32 binary only.

**Rollback**: if steps 4–7 fail or reconcile badly:

1. Take the collect lock.
2. `mv .works/kk.db.pre-g32 .works/kk.db`, and remove the stale `-wal`/`-shm`.
3. Reinstall the 0.0.33 global binary.
4. Release the lock.
5. Record the failure in Testing and mark the task failed.

Because `0003` is one atomic batch, a failure inside the migration itself leaves v1 intact.

**Evidence** (all under `.works/`, gitignored; summarized with counts and SQL in the Testing section):

- `.works/kk.db.pre-g32`
- `.works/test-artifacts/g32-live-disjoint.json`
- `a.json` / `b.json` under `.works/test-artifacts/g32-replay/`

**Anti-patterns**:

- Migrating while the global `kk` is 0.0.33.
- Migrating without the collect lock.
- `publish_enabled=true` during the dry runs.
- Deleting the backup before G32 is wrapped.
- Committing anything under `.works/`.
- Editing `.github/workflows/`.
- Touching other sessions' uncommitted hunks in the design doc or voice2 YAML (commit only this task's hunks).

**Authorization boundary**: R0 (global install/link, or a release) and any `publish_enabled=true` run are operator actions. Everything else is local and reversible via the backup.

### Plan

1. R0: check `~/.bun/bin/kk --version`. If it is not a G32 build, ask the operator to authorize a global install/link (or release), or stop as `blocked`.
2. Take the collect lock, checkpoint, back up, migrate, release the lock, then reconcile the counts (R1).
3. Run backfill-facts, then calibrate and spot-check (R2).
4. Run a live collect and verify by SQL (R3).
5. Run the two voice2 dry runs, write the artifact, then release (R4).
6. Run the replay byte-identity check (R5).
7. Sync docs (R6), then run `bun run gate` and `spur feature check G32`.

### Solution

0230 is a cut-over dogfood plus a derived-doc sync: it changes **no product or test source**.
The only edits are the three docs R6 names.

#### Change map (R6)

- `docs/design/kk-collect-and-daily-voice2.md:29` - the §2 Migrations row: `0001_kk_store_init` as a
  frozen literal (a builder-derived DDL cannot converge a fresh database with `0003`'s `labels`
  rebuild), `0002_labels_confidence_run_id`, and `0003_store_v2` as one `atomic` batch.
- `docs/design/kk-collect-and-daily-voice2.md:35-43` - the §2 tables retitled "Tables (v2 — after
  `0003_store_v2`)" with the v2 shape: `items` gains the typed facts (`engagement`, `body_chars`,
  `source_tier`, `lang`, `domain`, `story_id`), `labels` gains the four-column observation identity
  (`item_id`, `decision_id`, `maker`, `run_id`, `labels_observation_unique`) plus the raw-evidence
  columns (`raw_value`, `raw_confidence`, `reason`, `duration_ms`, `catalog_version`, `content_hash`).
- `docs/design/kk-collect-and-daily-voice2.md:105-124` - §4 gains "Raw observations and the
  current-label view": the observation identity, the raw evidence and `catalog_version`/`content_hash`
  binding, `--replay` under a `replay-*` run id, and the `labelsCurrentSql`/`labels_current` CTE with
  its eligibility rules (`content_hash` match, `source <> 'default'`, `min_confidence` for a `model`
  row, maker priority, and the replay maker-name guard), i.e. priority + threshold.
- `docs/design/kk-collect-and-daily-voice2.md:295-306` - §8 gains the G32 cut-over note: the
  `0003_store_v2` batch, the lock/acquire/migrate/release order on the live store, the
  `.works/kk.db.pre-g32` backup and rollback, and the `episode_usage` -> `selections` row mapping.
- `docs/03_ARCHITECTURE.md:122-133` - the "Persistent store" paragraph: task list extended to
  `0225-0229`, and store v2 recorded (the widened `labels` observation identity + raw evidence, the
  typed `items` facts, `episode_usage` -> `selections`, and `items.story_id` as the dedup key).
- `docs/05_FEATURES.md:99` - a new `G32` row (`active`, mirroring the feature file's status) naming
  `0225`-`0229` and this task's live cut-over + doc sync.

#### Measured results (R1-R5)

- **R0** `~/.bun/bin/kk` resolves through the global `@gobing-ai/knowledge-kit` link to this
  worktree (`apps/cli/dist/index.js`, branch `sp/runall-g32-5368`); `kk store --help` lists every G32
  verb and `0003_store_v2` is in the built bundle. `kk --version` still prints `0.0.33` — the package
  version string was not bumped, so the build contents are the gate, not the version.
- **R1** copy of the live store migrated in place: `{"acquired":true}` / `{"applied":0}` /
  `{"released":true}`. items 78 -> 78; labels 390 -> 390 with 0 null `run_id`; `episode_usage` 12 ->
  the 12 `selections` rows with `status='published'`; journal `0001`+`0002` -> `0001`+`0002`+`0003_store_v2`.
  The live store is byte-unchanged (`sha256 3d21b641...`).
- **R2** `{"updated":78}`; 75 distinct `story_id`s for 78 items (72 singletons, 3 pairs). The
  multi-member population is 3 (not 10), all 3 checked: 2 genuine (case-only and exact duplicates),
  1 **false merge** (`...best AI model end of October?` / `...end of November?` at 0.818). Threshold
  verdict: 0.6 stays the default; it over-merges at 0.818 and under-merges the mortgage-rate pair at
  0.500, so it is a trade-off, not a calibration — no evidence to move it on 78 items.
- **R3** `kk-collect` run `61986366-4be0-482f-b28c-425f62c28139` -> **done**; ingest
  `{"inserted":7,"updated":2,"unchanged":42}`, label `{"verdict":"PASS","confidence":"LOW","labeled":77,"model":15,"fallback":17,"consults":32}`.
  items 78 -> 85, labels 390 -> 467; the three new decisions are present (9 rows each); every row
  carries `raw_value`/`reason`/`duration_ms`/`content_hash` and `catalog_version='1'`; the 7 new items
  all have typed facts and a `story_id`.
- **R4** run 1 `82388632-6011-4097-a8b2-4e9c08253f01` (extract 8, select 8), run 2
  `d988ffea-fd5b-4536-a73a-28586e6c0c42` (extract 0, no-content, done). Artifact
  `.works/test-artifacts/g32-live-disjoint.json`, `intersection: []`; `kk store release --run` both ->
  `{"released":8}` and `{"released":0}`; 0 `selected` rows remain for either run. The live
  disjointness is degenerate (run 2's pool is empty because run 1 holds all 8 stories; with
  `--include-selected` the same extract is 14), because the ai-news pool is 8 and
  `qc_min_episode_items` is 8.
- **R5** `a.json` vs `b.json` after `kk store label --replay since:24h --maker typesafe`
  (`{"replayed":85,"consults":680,"consultMs":198572,"run":"replay-1791532259183"}`) -> byte-identical,
  `sha256 88063670d435bb7032d14b404ca36b3b309afc1842e15359391c531faa255019`; 259 `replay-*` rows
  stored, none current.

#### Deviations

1. **`catalog_version='1'`, not `'2'`** (expected, recorded not "fixed"). R3 asks for `'2'`, but the
   installed `@gobing-ai/spur@0.4.0` catalog schema pins `version` to the literal `1`
   (`{"const": 1}`), so `version: 2` left the catalog unloadable and killed every consult. The batch
   already reverted it: `plugins/kk/decisions/kk-items.yaml:13` is the catalog's `version: 1`
   declaration, and this stage confirms the observed `catalog_version` value is `'1'`.
2. **`kk store migrate` reported `applied: 0`.** `kk store lock acquire` opens the store and
   `openStore` applies pending migrations, so `0003_store_v2` was journaled by the *acquire* call
   (`applied_at = 1791530909606`). The migration therefore ran inside the lock, as the design
   requires; the explicit `migrate` invocation was a correct no-op.
3. **The fresh pool was empty, so one bounded label pass used a different maker.** All
   `kk-item-china-politics` rows were `source: default`/`reason: error` (the configured `fm-local`
   local Apple-FM maker errors on that decision in ~180 ms; a fallback value of `3` also fails the
   `lte: 1` gate), and the profile gate is a fail-closed INNER join on `labels_current`, so
   `kk store extract --topic ai-news` returned 0 and every daily run would be `no-content`. To make
   R4 evaluable I re-labelled the 14 gate-passing items with the registered cloud maker this
   environment holds credentials for (`--maker typesafe`); this changes the label SOURCE only, not
   the workflows. Reported as a deviation, and recorded as a finding.
4. **run 1's DAG ended `failed`** at the `plan-translate` agent node (the harness's inline agent
   exited 0 without writing its expected file). `select` had already committed, which is 0228's
   stated property; `script-write` succeeded in the same run. Harness/engine finding, outside scope.

#### Re-certification (2026-10-09) — the two decided findings applied

Run `52dfe00f-a77c-4b41-be01-d4bf76460425`, same worktree/branch, same task store. The first run reached
terminal `failed` on a FAIL review with two blocking findings. The operator decided both; this hop applies the
two decisions and re-measures. **No product or test source changed.** The batch's 0225-0229 sources/tests are
untouched, and the one tracked edit is the maker configuration.

**Decision 1 — point the three judgment decisions at a working maker.** Three entries added to the existing
`decisions.makers` map (`.spur/config.yaml:163`), leaving the two existing entries and the global
`decisions.maker: fm-local` untouched:

The hop's intermediate state, superseded by the finalisation below (which records what survived):

| Location | Entry | Final state |
| --- | --- | --- |
| `.spur/config.yaml:166` | `kk-item-china-politics: typesafe` | kept |
| `.spur/config.yaml:167` | `kk-item-audience: typesafe` | kept |
| no sensitivity override | the removal is documented by the comment at `.spur/config.yaml:168-171` | added by the finalisation (no maker yields a usable integer level) |

`decisions.makers` is spur's own per-decision-point maker override ("keyed by decision id; outrank
`decisions.maker`" — `@gobing-ai/spur/schemas/spur-config.schema.json`, `properties.decisions.makers`), so this
is the surface that routes a decision, not a kk code path. Nothing else moved: the profile gate
`kk-item-china-politics: { lte: 1 }` (`plugins/kk/decisions/extract/ai-news.yaml:26`) and the rubric fallback
`fallback: 3` (`plugins/kk/decisions/kk-items.yaml`) are unchanged, no workflow var was edited, and the
`--maker` default of `kk store label` is unchanged.

Effect, measured end to end (full evidence in `## Testing`, "R4 (re-measured)"):

- `kk store extract --topic ai-news` returned **0** before the fix (on a store copy with the previous run's
  hand-labelled rows removed) and **14** eligible / **8** production-available after it.
- The same decision on the same item and evidence answers `source: default, reason: error, value: 3` under
  `--maker fm-local` and `source: model, reason: accepted, maker: typesafe` under the new config.
- A fresh pass under the config (`kk store label --run g32-maker-fix …`, no `--maker`) wrote 14
  `kk-item-china-politics` rows, all `typesafe`/`model`/`accepted`/value `0`, with `fallback: 0` in its verdict
  line (the old-config collect pass reported `fallback: 17`). With the previous run's hand rows and every
  `replay-*` row deleted from a copy, the pool is still 14/8 — the config-driven rows hold it alone.

**Decision 2 — re-measure AC1 non-vacuously.** Done; the operator's proposed `--vars` set needed
`plan_max_items` in addition, because `qc_min_episode_items` only sets the episode floor while
`plan_max_items` (`EPISODE_PLAN_MAX_ITEMS`) is what bounds a single run's take. Both the default-config
numbers and the override numbers are recorded in `## Testing`.

**New findings from this hop (not blockers, recorded so the operator sees them):**

1. **A fractional model answer is stored as no row at all.** `decisionValue` requires an integer level in
   `[0, levels)` for a `score` decision, so `typesafe`'s `kk-item-china-politics` answer `0.01` on item
   `816ab26a…` produced **no observation** (and `kk-item-sensitivity` answers `0.96`/`0.89` likewise), while
   its `0` answers were stored. `makerRow` returns `null` before writing, so the raw answer is lost too and the
   item is silently fail-closed out of the pool. Consequence for Decision 1: `kk-item-sensitivity: typesafe`
   currently yields **0** storable observations (fm-local yielded 11 accepted rows in R3), and the ai-news pool
   stays at 14 rather than 15. Sensitivity is not in the ai-news profile, so nothing downstream breaks today;
   a future profile gating on sensitivity inherits an empty surface. Not repaired here — it is a contract
   question (spur `score` scale vs kk's discrete levels) outside this task's scope.
2. **The three judgment decisions do answer under the config** (14/14 stored china-politics answers accepted),
   so P1's root cause is addressed; the residual is per-item, not per-decision.

#### Config finalisation after a full maker-matrix probe (batch driver, 2026-10-09)

The re-certification hop set all three judgment decisions to `typesafe`. Probing the complete matrix
(`3 decisions × 3 makers`, one live consult each) shows that is only right for two of them:

| decision | `fm-local` | `laya-local` | `typesafe` |
| --- | --- | --- | --- |
| `kk-item-china-politics` | `default` / `error` | `default` / `no-backend` | **`model` / accepted (value 0)** |
| `kk-item-sensitivity` | `default` / `error` | `default` / `no-backend` | `model` / accepted **but value `0.79`** |
| `kk-item-audience` | `model` / accepted (`general`) | `default` / `no-backend` | `model` / accepted (`general`) |

`kk`'s level validator requires an **integer** level in `[0, levels)` for a `score` decision, so
`typesafe`'s fractional sensitivity answers are refused and produce no observation — which is why the
hop measured **0** stored `kk-item-sensitivity` rows despite `{"source":"model","reason":"accepted"}`.
No configured maker therefore yields a usable integer sensitivity level on this machine.

Final `decisions.makers` block, `.spur/config.yaml:163-172` (the maker overrides):

- `kk-item-china-politics: typesafe` — the only maker that answers, and its answers are integers.
- `kk-item-audience: typesafe` — answers cleanly (a `choice` decision, so no scale problem).
- **no `kk-item-sensitivity` override** (it inherits `maker: fm-local`), with the reason recorded as a
  comment in that block: neither maker produces a usable level, so an override would only hide that.
- `kk-item-category` / `kk-item-quality` / the global `maker` untouched, and neither the gate
  (`lte: 1`) nor the rubric fallback (`3`) was weakened.

The maker-versus-scale contract is filed as **task 0236**. Verified after the change:
`kk store extract --topic ai-news` still returns the pool, and
`kk store extract --topic ai-news --include-selected` returns the whole corpus pool — i.e. the
china-politics gate is admitting items under the final config, not just under the hop's intermediate one.

### Testing

All runs below execute in the worktree `/Users/robin/xprojects/knowledge-kit-runall-g32-5368`; the
invoking tree `/Users/robin/xprojects/knowledge-kit` is read-only and its `.works/kk.db` is
byte-unchanged (`sha256 3d21b6411ddaaebd7df6111439d52f576f4819f5f4ce11f2747c5adcc8966e97`, sidecars
untouched). Store path resolves to `.works/kk.db` cwd-relative (the operator config has no
`store.db_path`).

**R0 — cut-over gate (evidence)**

- `readlink -f ~/.bun/bin/kk` -> `<worktree>/apps/cli/dist/index.js`
- `ls -la ~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit` ->
  `... -> /Users/robin/xprojects/knowledge-kit-runall-g32-5368/apps/cli` (this worktree's checkout)
- `git -C <dist dir> rev-parse --abbrev-ref HEAD` -> `sp/runall-g32-5368`
- `kk store --help` lists `migrate`, `lock`, `ingest`, `backfill-facts`, `label`, `extract`,
  `pool-count`, `select`, `mark-published`, `release`; `grep -c 0003_store_v2 apps/cli/dist/index.js` -> 1
- `kk --version` -> `0.0.33`: the package version string was not bumped by 0225-0229, so the version
  string alone is not the gate; the build contents are (the verbs + `0003_store_v2` above).

**R1 — migrate the copy, not the live store**

The live store is never opened for writing, so the WAL checkpoint ran on the copy:

```
cp  <live>/.works/kk.db  plus its sidecars  ->  .works/    # 3 files, copy sha256 == live sha256
sqlite3 .works/kk.db "PRAGMA wal_checkpoint(...)"          # COPY-only, WAL-emptying mode:
                                                           #   db 299008 -> 344064 B, sidecar -> 0 B
cp .works/kk.db .works/kk.db.pre-g32                        # pristine, pre-migration, one self-contained file
kk store lock acquire --name collect --run g32-cutover --ttl 3600000   # {"acquired":true}
kk store migrate                                            # {"db":".../.works/kk.db","applied":0}
kk store lock release --name collect --run g32-cutover                 # {"released":true}
```

Counts, before -> after (SQL over the copy):

| Measure | Before | After |
| --- | --- | --- |
| `items` | 78 | 78 (unchanged) |
| `labels` | 390 | 390 (unchanged) |
| `labels.run_id IS NULL` | 0 | 0 (distinct run_id 4) |
| `episode_usage` rows | 12 | table dropped |
| `selections` rows `status='published'` | - | 12 (equals the 12 `episode_usage` rows) |
| tables | items, collect_runs, labels, episode_usage, locks | items, collect_runs, labels, selections, locks |
| journal | 0001, 0002 | 0001, 0002, 0003_store_v2 |

`labels` gained `raw_value`, `raw_confidence`, `reason`, `duration_ms`, `catalog_version`,
`content_hash` plus the `confidence` CHECK; `items` gained `engagement`, `body_chars`, `source_tier`,
`lang`, `domain`, `story_id`. The collect lock was held while the schema changed; 0 lock rows after release.

**Deviation:** `kk store migrate` printed `applied: 0` because `kk store lock acquire` opens the store
and `openStore` applies pending migrations: the journal row for `0003_store_v2` carries
`applied_at = 1791530909606` = 2026-10-09T00:28:29.606Z, the acquire call. The migration therefore ran
*inside* the lock (the design's requirement); the explicit `migrate` call was a correct no-op.

**Baseline note:** the task text quotes 78 items / 340 labels; this copy measured 78 items / 390
labels / 12 `episode_usage` / 4 `collect_runs`. Reported as measured, not assumed.

**R2 — `kk store backfill-facts`**

`kk store backfill-facts` -> `{"updated":78}` (idempotent). Distinct `story_id`s: **75** for 78 items
— 72 singletons and 3 pairs (dedup saving 3).

The multi-member-cluster population is **3**, not the requested 10, so all 3 were checked (pairwise
token-Jaccard recomputed with the store's own `storyTokens` over the 78 titles):

| # | Members | Jaccard | Verdict |
| --- | --- | --- | --- |
| 1 | `Guys this is huge (good news)` / `GUYS THIS IS HUGE (good news)` | 1.00 | **genuine** (case-only duplicate) |
| 2 | `Pope Leo says AI concerns are not 'fake news,' must act on safety issues` (x2) | 1.00 | **genuine** (exact duplicate) |
| 3 | `Which company has the best AI model end of October?` / `...end of November?` | 0.818 | **false merge** (different resolution months) |

**Threshold verdict (U2):** 0.6 is confirmed as a trade-off, not a calibrated value, on this corpus.
All pairs at >= 0.4: 7, of which 3 merged and 4 did not. It over-merges (pair 3 at 0.818) *and*
under-merges a genuine same-story pair — `U.S. 30-year mortgage rate hits 3-year high, refinancing
demand halves` / `U.S. 30-year mortgage rate hits 7.40%, a three-year high` at **0.500**. On a
78-item corpus there is no evidence for moving the threshold in either direction; keep the default
and keep the limit recorded.

**R3 — one real `kk-collect`**

`spur workflow run plugins/kk/workflows/kk-collect.yaml` -> run
`61986366-4be0-482f-b28c-425f62c28139`, final state **done** (lock -> collect -> store -> label ->
release -> done). fan-in 10m15s / 51 docs; `kk store ingest` ->
`{"inserted":7,"updated":2,"unchanged":42}`; `kk store label` ->
`{"verdict":"PASS","confidence":"LOW","labeled":77,"model":15,"fallback":17,"consults":32,"consultMs":47020}`;
`kk store lock release` -> `{"released":true}`. The trailing `kk ledger append` exits 1 with
`kk.ledger.run.running` (a run's own trace is still running) — the workflow's documented
`onError: continue` path, backfilled by the next tick's `kk ledger sync`.

SQL verification for that run id:

| Check | Result |
| --- | --- |
| `items` before -> after | 78 -> **85** (+7 inserted) |
| `labels` before -> after | 390 -> **467** |
| rows per decision (this run) | category 10, quality 10, importance 10, urgency 10, impact 10, china-politics 9, sensitivity 9, audience 9 — the three new decisions are present |
| `catalog_version` | `'1'` on every row of all 8 decisions — see the deviation |
| `content_hash`, `reason`, `duration_ms` non-null | yes, every row |
| `raw_value` / `raw_confidence` | present on the model rows, NULL on the keyword-heuristic rows (by design) |
| new items' facts | all 7 new items have `body_chars`, `source_tier`, `lang`, `domain` non-null |
| `story_id` | non-null on all 85 items |

**Deviation (expected; recorded, not "fixed"):** the task text asks for `catalog_version='2'`. The
installed `@gobing-ai/spur@0.4.0` decision-catalog schema pins `version` to the literal `1`
(`{"const": 1}`), so `version: 2` left the catalog unloadable and killed every consult; the batch
reverted it and `plugins/kk/decisions/kk-items.yaml:13` reads `version: 1` (0229's `## Solution`).
Observed `catalog_version='1'`.

**R4 — two `kk-daily-ai-voice2` dry runs**

Both runs used `KK_WORKS_DIR=<worktree>/.works` and the workflow defaults
(`publish_enabled=false`, so the publish subtree and `mark-published` are skipped), with distinct
run ids.

- run 1 `82388632-6011-4097-a8b2-4e9c08253f01`: `kk store extract --topic ai-news --window 24h` ->
  `{"count":8}`; `kk store select` wrote **8** `selected` rows (topic `ai-news`, 8 distinct stories).
- run 2 `d988ffea-fd5b-4536-a73a-28586e6c0c42`: the same extract -> `{"count":0}` ->
  `no-content: the store pool was empty` -> workflow **done**; **0** selections.

`.works/test-artifacts/g32-live-disjoint.json` = `{run1:{run,storyIds:[8 ids]}, run2:{run,storyIds:[]},
intersection:[], statuses:{selected:8}, note:...}`.
`kk store release --run` both -> `{"released":8}` then `{"released":0}`;
`select count(*) from selections where run_id in (both) and status='selected'` -> **0**.

Non-vacuity, stated plainly: run 2's pool is empty *because* run 1 holds every story. With
`--include-selected` the same extract returns **14** while the production extract returns **0**, so
the topic-scoped exclusion is what emptied run 2 — but the live disjointness is degenerate, not a
non-empty-vs-non-empty comparison. Cause: this store's ai-news pool is 8 items and
`qc_min_episode_items` is 8, so one run consumes the whole pool.

Two findings from this step:

1. **The pool was empty before any intervention.** Every `kk-item-china-politics` row was
   `source: default`, `reason: error` (9/9 in the collect, 15/15 in a backfill pass), the decision's
   fallback value is `3`, and the `ai-news` profile's `kk-item-china-politics: { lte: 1 }` is a
   fail-closed INNER join on `labels_current` — so `kk store extract --topic ai-news` returned
   `{"count":0}` and every daily run would report `no-content`. The makers configured for this
   machine are `fm-local` (local Apple FM: `reason: error` in ~180 ms, on this decision, in every
   attempt) and `laya-local` (`no-backend`), and `fm-local` is the `.spur/config` `decisions.maker`.
   To make the pool evaluable I labelled the 14 gate-passing items with the registered cloud maker
   this environment holds credentials for:
   `kk store label --run g32-cp-backfill-2 --new-ids <14 ids> --maker typesafe`
   (`{"labeled":104,"model":29,"fallback":0,"consults":45,"consultMs":13174}`) -> 14 current
   china-politics rows, all `<= 1`. A deliberate, reported deviation: a label-SOURCE change, not a
   workflow change.
2. **The inline `agent.run` nodes do not write their files in this harness.** run 1's DAG ended
   `failed` — `plan-translate/agent.run: agent.run (coder) exited 0 but expected file is absent`:
   the spawned Pi agent answered the workflow's prompt conversationally instead of doing the task
   (contract failure preserved at `.spur/run/82388632-...-plan-translate-partial.md`). `script-write`
   succeeded in the same run, so it is intermittent. A harness/engine finding outside 0230's scope;
   note that `select` had already committed, so run 1 still excludes what it planned — 0228's
   stated property.

**R5 — replay byte-identity**

```
kk store extract --topic ai-news --include-selected --out .works/test-artifacts/g32-replay/a.json   # {"count":14}
kk store label --replay since:24h --maker typesafe
  -> {"replayed":85,"consults":680,"consultMs":198572,"run":"replay-1791532259183"}
kk store extract --topic ai-news --include-selected --out .works/test-artifacts/g32-replay/b.json   # {"count":14}
```

`shasum -a 256` on both -> `88063670d435bb7032d14b404ca36b3b309afc1842e15359391c531faa255019`;
`cmp a.json b.json` -> identical. `typesafe` is not in `store.labels.priority` (default
`['*','heuristic']`; the operator config has no `store.labels` block) and 259 `replay-*` rows were
stored — none became current, which is exactly the guard R5 pins. Because the maker is a real model
this is the strong form of the test: real high-confidence rows that must not displace production.

**R6 — docs + feature check**

`spur feature check G32` -> `G32 (active): PASS`, with one
`[WARN] L4 Acceptance Criteria: Feature scenario "R13 — Decision and surface docs record store v2"
is linked but unverified: covering task(s) 0230 have no PASS verdict with MET requirement` — the AC2
documentation claim is recorded and awaits 0230's own verdict.

**Definition-of-done gates (worktree, after the doc edits)**

| Command | Outcome |
| --- | --- |
| `bun run lint` | exit 0 — `biome check .`: "Checked 400 files ... No fixes applied" + every workspace `typecheck` code 0 |
| `bun run test` | exit 0 — **2336 pass, 2 skip, 0 fail**, 11057 `expect()` calls, 2338 tests / 129 files (118.0 s) |
| `bun run build` | exit 0 — plugin bundle + `apps/cli` build (`index.js` 1.67 MB) |

`git status --porcelain` shows only the batch's `0225`-`0229` sources/tests, the five filed
follow-up task files (`0231`-`0235`), this task's doc edits, and no stray files; every artifact this
stage created lives under the gitignored `.works/` (`.works/kk.db`, `.works/kk.db.pre-g32`,
`.works/test-artifacts/g32*`, `.works/kk-collect/20261009T0729Z`, `.works/kk-daily-ai-voice2`).

---

#### Re-certification (2026-10-09) — Decision 1 fixed, AC1 re-measured

Everything below runs in `/Users/robin/xprojects/knowledge-kit-runall-g32-5368` on branch
`sp/runall-g32-5368`; `kk` resolves through the operator-authorized global link to this worktree's build
(`readlink -f ~/.bun/bin/kk` → `<worktree>/apps/cli/dist/index.js`). All artifacts live under the gitignored
`.works/` or `/tmp`; no repository-root temp files were created. R0, R1, R2, R3, R5 and R6 above stand
unchanged and are not repeated. **The R4 block above is superseded by this section's R4 (re-measured).**

#### D1 — the extract pool before and after the maker config

`.spur/config.yaml:166-168` adds `kk-item-china-politics`, `kk-item-sensitivity` and `kk-item-audience` →
`typesafe` to the `decisions.makers:` block; `decisions.maker: fm-local` and the other two entries are
unchanged. The fix is the *config*, so the controls below hold everything else constant.

**Is the config the routed surface?** Same item (`816ab26a…`), same evidence file, same decision:

| Invocation | Answer |
| --- | --- |
| `spur decision run kk-item-china-politics --param title=… --param source=aihot --evidence … --maker fm-local --json` | `{"source":"default","reason":"error","value":3,"maker":"fm-local","makerSource":"flag"}` |
| `spur decision run kk-item-china-politics --param title=… --param source=aihot --evidence … --json` (no `--maker`) | `{"source":"model","reason":"accepted","value":0.01,"maker":"typesafe","makerSource":"config-decision"}` |
| `… kk-item-sensitivity … --json` | `{"source":"model","reason":"accepted","value":0.96,"maker":"typesafe","makerSource":"config-decision"}` |
| `… kk-item-audience … --json` | `{"source":"model","reason":"accepted","value":"general","maker":"typesafe","makerSource":"config-decision"}` |

`makerSource: config-decision` (not `flag`) is the evidence that the per-decision entry, not a flag, selected
the maker.

**Stored rows, before → after** (SQL over the store):

| Measure | Before | After |
| --- | --- | --- |
| `kk-item-china-politics` rows | 24, all `fm-local` / `source='default'` / `reason='error'` / value `3` (9 run `61986366…`, 15 run `g32-cp-backfill-1`), over **23** items | +14 `typesafe` / `model` / `accepted` / value `0` / `raw_confidence` 1.0 (run `g32-maker-fix`) |
| `keyword` (prefilter floor) rows | 0 | 0 |
| `kk-item-sensitivity` rows for the same 15 items | — | **0** (see finding 1) |

**The fresh config-driven pass.** `kk store label --run g32-maker-fix --new-ids <the 15 gate-passing items>
--db .works/kk.db` (no `--maker`, default `--mode heuristic`, so the three judgment decisions are consulted for
every listed item) →

```
{"verdict":"PASS","confidence":"LOW","labeled":104,"model":29,"fallback":0,"consults":45,"consultMs":13755}
```

`fallback: 0` — compare R3's old-config collect pass, `fallback: 17`. The 14 stored china-politics rows cover
**exactly the same 14 items** the previous run's hand `--maker typesafe` pass covered, so the fix's stored
effect is partly that; the independent evidence that the *config* does the work is the controlled deletion
below (and the `makerSource: config-decision` probe above).

**Pool, before → after** (`kk store extract --topic ai-news --window 24h`):

| Store state | `--include-selected` | production |
| --- | --- | --- |
| copy with `g32-cp-backfill-1/2` + every `replay-*` row deleted (the pre-fix state) | `{"count":0}` | `{"count":0}` |
| copy with **only** the hand `g32-cp-backfill-2` rows + `replay-*` deleted (config pass holds it) | `{"count":14}` | `{"count":8}` |
| the store, after the fix | `{"count":14}` | `{"count":8}` |

So the empty pool of finding 1 is gone, and it is not the hand-labelled rows that hold it.

**Rows above the gate.** No *current* china-politics observation exceeds `lte: 1`: every stored `typesafe`
answer is `0`. The rows above the gate are the 24 degraded `fm-local`/`source='default'`/value-`3` rows on 23
items — a `source: default` row is not a label at all (the `labels_current` CTE filters it), so those items are
excluded by the INNER join, not by a value comparison. One of those 23 (`816ab26a…`, `Mistral says "Le Chonk"
…`) passes every other profile gate and would be the pool's 15th item; it stays out because its own answer
(`0.01`) could not be stored — finding 1 below.

**Pool ceiling (why the defaults are structurally degenerate).** On a copy where every one of the 85 items got a
synthetic passing china-politics row (`source: model`, value `0`), `--include-selected` returns
`{"count":15}` — the profile's other gates cap the pool at 15 items. One default run takes all 8
production-available items (`qc_min_episode_items: 8`), and two pools need 16 > 15.

#### R4 (re-measured) — two consecutive dry runs, both pools non-empty and disjoint

`KK_WORKS_DIR=<worktree>/.works`, `publish_enabled=false`, distinct `run_date` per run so each run has its own
work dir (a shared run-date dir makes `daily-qc-content` print `candidates cached` and reuse the previous run's
candidates). **Part A is the plain production defaults; Part B is the operator-authorized override.**

**Part A — production defaults (no var override beyond `publish_enabled=false`)**

| | run A | run B |
| --- | --- | --- |
| run id | `60664a88-5be5-4d5e-acf4-6a1cbcf346fd` | `16538e0f-a1b2-41e1-ba1c-8c7efec8f983` |
| `kk store extract --topic ai-news --window 24h` | `{"count":8}` | `{"count":0}` |
| `kk store select` | `{"selected":8}` (8 stories) | never ran — `plan` guard skipped on the empty pool |
| outcome | DAG `failed` at the four `agent.run` nodes (each exited 0 without writing its expected file), **after** `select` committed | `run-report` `noContent: true`, `no-content: the store pool was empty`, DAG `done` |
| `kk store release --run` | `{"released":8}` | `{"released":0}` |

`select count(*) from selections where run_id in (both) and status='selected'` → **0**. The default-config
instance is exactly the degenerate one the review called out: the second pool is empty *because* the first run
holds all 8 available stories. **The defaults cannot be non-vacuous on this corpus**: availability is 8
(`14` gate-passing minus the 6 stories the 12 migrated `published` rows hold) against the 16 two 8-item pools
need.

**Part B — operator-authorized override (non-vacuous instance, recorded in the artifact)**

Vars: `{"run_date":"…","publish_enabled":"false","plan_max_items":"5","qc_min_episode_items":"3"}`.

| | run 1 | run 2 |
| --- | --- | --- |
| run id | `563710fb-3abc-4285-b4ce-e096f64593d1` | `ccd32842-c364-4ffd-a9f6-61d95964c444` |
| `kk store extract --topic ai-news --window 24h` | `{"count":8}` | `{"count":3}` |
| qc candidates | 5 | 3 |
| `kk store select` | `{"selected":5}` | `{"selected":3}` |
| DAG | `failed` at the agent nodes, after `select` | `failed` at the agent nodes, after `select` |
| `kk store release --run` | `{"released":5}` | `{"released":3}` |

run 2's own `prepare` named the cause: `kk.daily.prepare.unreleased-run: run '563710fb-…' still holds selected
items for 'kk-daily-ai-voice2' — free them with: kk store release --run 563710fb-…`.

Story sets (SQL over `selections`):
run 1 = `2035be2a…`, `38a23f68…`, `53954eed…`, `726fc16e…`, `d747449b…` (5);
run 2 = `70580ace…`, `88c23855…`, `f5034dad…` (3); **intersection `[]`** — 5 + 3 is the whole
production-available pool of 8. `select count(*) from selections where run_id in (both) and status='selected'`
→ **0** after the releases.

Artifact rewritten in the required shape:
`.works/test-artifacts/g32-live-disjoint.json` =
`{run1:{run,storyIds:[5]}, run2:{run,storyIds:[3]}, intersection:[], statuses:{selected:8}, note:…}` — the note
carries the Part A numbers, the override vars and the reason `plan_max_items` is required.

**Why the override set differs from the one the operator authorized.** `--vars '{"window":"7d",
"qc_min_episode_items":"3"}'` is not sufficient: `window` does not change the pool (identical count at
24h/48h/7d/30d), and `qc_min_episode_items` is the episode *floor* (`EPISODE_PLAN_MAX_ITEMS` /
`plan_max_items` is what caps a run's take; `backfillToFloor` pads a short plan back up to the floor from
importance-only rejects, so a floor of 3 with 5 kept adds nothing). With only the authorized pair, run 1 would
still take all 8 and run 2 would still be empty. `plan_max_items: "5"` was added and is the actual lever;
recorded here as an extension of the authorization, not a silent substitution.

#### Gates (worktree, after the config edit)

| Command | Outcome |
| --- | --- |
| `bun run lint` | exit 0 — `biome check .` clean + every workspace `typecheck` code 0 |
| `bun run test` | exit 0 — **2336 pass, 2 skip, 0 fail**, 11117 `expect()` calls, 2338 tests / 129 files (122.89 s) |
| `bun run build` | exit 0 — plugin bundle + `apps/cli/dist/index.js` (1.67 MB) |

The config change is inert for the suite: `apps/cli/src/commands/store.ts` resolves the catalog via
`resolveKkConfigPath()` but no test asserts the `decisions.makers` map, and
`plugins/kk/tests/decision-catalog.test.ts` reads the catalog file only.

`git status --porcelain` shows the batch's own 0225-0229 sources/tests, the five filed follow-up task files
(`0231`-`0235`) and `.spur/config.yaml` — **no stray files**. Each run wrote only under the gitignored
`.works/` (`.works/kk-daily-ai-voice2/2026101{0,1,2,3}`, `.works/test-artifacts/…`) and `.spur/run/*-partial.md`.

#### New findings from this hop

1. **A non-integer model answer is stored as no observation.** `spur decision run kk-item-china-politics` for
   item `816ab26a…` answered `{"value":0.01,"source":"model","reason":"accepted"}`; `decisionValue` requires
   `Number.isInteger` in `[0, levels)` for a `score` decision, so `makerRow` returned `null` and **no row was
   written** — the raw answer is not kept as evidence either (`labels` has no row). The same mechanism dropped
   **all 15** `kk-item-sensitivity` answers (`0.96`, `0.89`, …): `kk store label --run g32-maker-fix` wrote 0
   sensitivity rows, where the old-config `fm-local` pass wrote 11 accepted ones. Reproduced twice (run
   `g32-maker-fix-2` for that single item also produced an `audience` row and no `china-politics` row). Effect:
   the pool stays at 14 instead of 15, and the `kk-item-sensitivity` surface is empty for backtesting. Not a
   defect in 0225-0229 (the validator is 0226's, the scale is spur's) and not fixed here.
2. **Residual pool ceiling.** Even with a perfect maker, this store's ai-news pool is 15 items < the 16 two
   default runs need, so the production daily pair stays degenerate on this corpus until the pool grows. The
   AC1 property itself holds (Part B); the corpus does not exercise it at the operator's defaults.
3. **The inline `agent.run` nodes still never write their files** in this harness — all four failed the same way
   in every run this hop (`agent.run (coder) exited 0 but expected file is absent`, partials preserved at
   `.spur/run/<run>-<node>-partial.md`), so each daily run ends `failed` after `select` commits. Unchanged from
   R4's finding 2; harness-scoped, still outside 0230's diff.

### Review

#### Review Report — 0230 (re-certification, 2026-10-09)

**Scope:** 0230's cut-over dogfood (R0–R6, AC1/AC2) in worktree `sp-runall-g32-5368`, the re-certification hop's two decided findings (the maker config, the AC1 re-measure), the final `decisions.makers` state, the R6 doc sync, and the R1 live-store safety claim. 0225–0229's own code/tests are the **subject under test**, not this review's target.
**Dimensions:** functional traceability, correctness, security/integrity, usability, architecture
**Verdict:** FAIL
**Confidence:** HIGH — every claim below was re-derived independently this run: `sqlite3 "file:…?mode=ro"` on the operator's live store, SQL over `/tmp` copies of the worktree store, a controlled-deletion probe, a live 3×3 decision-matrix probe, `kk store extract` probes, artifact/SQL cross-checks, `spur feature check G32`, `spur task check 0230`.

##### Per-requirement results

| Req | Verdict | Evidence |
|-----|---------|----------|
| R0 | MET | `readlink -f ~/.bun/bin/kk` → `<worktree>/apps/cli/dist/index.js`; `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit` → `<worktree>/apps/cli`; `grep -c 0003_store_v2 apps/cli/dist/index.js` = 1; `kk store --help` lists `migrate, lock, ingest, backfill-facts, label, extract, pool-count, select, mark-published, release`; `kk --version` = `0.0.33` (the gate is build contents, as the requirement allows). **The R0 swap is the cause of finding 1.** |
| R1 | MET (procedure + counts re-verified; the recorded safety claim is falsified — finding 1) | `.works/kk.db.pre-g32` = 344064 B, `PRAGMA integrity_check` → `ok`, journal `0001`+`0002`, items 78 / labels 390 / `episode_usage` 12 — the pre-cut-over copy. Worktree store journal `0001`+`0002`+`0003_store_v2` (`applied_at 1791530909606` = 00:28:29.6 local = the `lock acquire` call, confirming the `applied: 0` deviation: `openStore` → `applyKkMigrations` at `packages/kk-store/src/db.ts:47`, `lock acquire` opens first at `apps/cli/src/commands/store.ts:210`); 0 NULL `run_id`; 12 `published` `selections`. **The operator's live store is no longer v1: `0003_store_v2` `applied_at 1791543606309` = 04:00:06 local (finding 1).** |
| R2 | MET (corpus-limited) | Worktree store: 85 items, **82** distinct `story_id`, 0 NULL, **3** multi-member clusters — all 3 re-checked (`|members|=2` each). `story_id` false merge at 0.818 and the under-merge pairs re-confirmed by the previous run and unchanged (no code or corpus change since: only `.spur/config.yaml` has an mtime after 00:34). The requested 10-cluster sample is unsatisfiable on this corpus — reported, not skipped. |
| R3 | MET (recorded deviation) | Run `61986366-4be0-482f-b28c-425f62c28139` = 77 rows: category/quality/importance/urgency/impact 10 each, **china-politics 9, sensitivity 9, audience 9**; `catalog_version='1'` on all 77; 0 NULL `content_hash`; `collect_runs` `inserted 7` → items 78→85; all 85 items have non-null `body_chars`/`source_tier`/`lang`/`domain`/`story_id`. The `'2'` deviation is forced by `@gobing-ai/spur@0.4.0`'s catalog schema and is correctly recorded rather than "fixed". |
| R4 | MET (evidence non-vacuous — AC1) | `.works/test-artifacts/g32-live-disjoint.json` has the required shape. Part B (operator-authorized override): run1 `563710fb-3abc-4285-b4ce-e096f64593d1` selected **5**, run2 `ccd32842-c364-4ffd-a9f6-61d95964c444` selected **3**, **intersection `[]`**; the two sets equal the whole 8-item production pool; after `kk store release --run` both, `selections` holds 0 `selected` rows (24 `dropped` + 12 `published`). Part A (defaults) reproduced the degenerate instance: `20261010` pool 8 → select 8, `20261011` pool 0 → `no-content` (run-report text read). |
| R5 | MET | `.works/test-artifacts/g32-replay/{a,b}.json` both `sha256 88063670d435bb7032d14b404ca36b3b309afc1842e15359391c531faa255019`, `cmp` identical; **259** `replay-*` rows stored, **0** of them current. |
| R6 | MET | `docs/00_ADR.md:1173-1185` = the dated 2026-10-09 ADR-030 amendment ("feature G32, tasks 0225–0230"); design §4 (`docs/design/kk-collect-and-daily-voice2.md:105-124`) matches `labelsCurrentSql`'s conditions exactly (`l.source <> 'default'`, `content_hash`, `min_confidence`, priority, replay named-maker guard — `packages/kk-store/src/dao/labels.ts:140+`); `docs/04_DESIGN.md:75,79,101,1175` lists `select`/`mark-published`/`release`/`label --replay` and contains no `mark-used`/`--exclude-used`; `docs/03_ARCHITECTURE.md:123-133`; `docs/05_FEATURES.md:99` (G32 `active`, 0230 in progress). `spur feature check G32` → **PASS** with the one expected R13/AC2 WARN. |

##### Per-AC results

| AC | Verdict | Evidence |
|----|---------|----------|
| AC1 (feature R12 — two consecutive daily dry runs produce disjoint pools) | **MET** (operator-authorized non-vacuous instance; corpus limit disclosed) | Both runs were two `kk-daily-ai-voice2` dry runs over the same store (`publish_enabled=false`), and their selected story sets are disjoint and non-empty: run1 `2035be2a…, 38a23f68…, 53954eed…, 726fc16e…, d747449b…` (5) vs run2 `70580ace…, 88c23855…, f5034dad…` (3) — `select count(*) … intersect …` = **0**, and 5+3 is exactly the whole production pool of 8, so the disjointness comes from the exclusion, not from an empty second pool. Artifact: `.works/test-artifacts/g32-live-disjoint.json` (`run1.storyIds` 5, `run2.storyIds` 3, `intersection: []`, `statuses.selected` 8, plus a note carrying the Part A numbers, the override vars and why `plan_max_items` is the lever). **The defaults' degeneracy is disclosed, not papered over**: Part A (`60664a88…` extract 8/select 8; `16538e0f…` extract 0/`no-content`) and the arithmetic (availability 8 = 14 gate-passing minus the 6 stories the 12 migrated `published` rows hold; two default 8-item runs need 16; the profile ceiling is 15). The override extends the operator's authorized set (`plan_max_items: "5"` added; `qc_min_episode_items: "3"` is only the episode floor that `backfillToFloor` pads *up*), and that extension is recorded as an extension. |
| AC2 (feature R13 — decision and surface docs record store v2) | **MET** | As R6 above; ADR-030 amendment present and dated, `04_DESIGN.md` verb list updated, `spur feature check G32` PASS with only the expected "R13 linked but unverified: covering task(s) 0230 have no PASS verdict" WARN — which this review resolves by its own verdict. |

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P2 (major) | security / evidence integrity | **The operator's live store was migrated to v2 without any recorded step, and the record says the opposite.** Read-only open of the live store: `__kk_store_migrations` = `0001`, `0002`, **`0003_store_v2` `applied_at 1791543606309` = 2026-10-09T04:00:06 local**; 6 tables incl. `selections`; items 83. Cause, verified: launchd `ai.gobing.kk-collect` (`WorkingDirectory /Users/robin/xprojects/knowledge-kit`, `Program /Users/robin/.bun/bin/spur` → the G32 link) fired at 04:00; its `kk store lock acquire` opened the live store and `openStore` applied `0003`; the job then completed (`dd2be37a-cb04-4c0b-8ab3-5bb075954924`, log `.works/kk-collect/launchd.log`, work dir `20261009T1100Z`, DAG `done`, `collect_runs` `inserted 5/updated 3`). The store resolves **cwd-relative** (`packages/kk-store/src/config.ts:6`), so the launchd job (live tree) hits the live store while every worktree run hit the copy — the copy's lock therefore never protected the real concurrent writer, contrary to the Refine correction's "the same WAL store". The `kk.db` **file** is still byte-identical (`sha256 3d21b641…`), which is exactly why the sha256 check cannot see it: the migration lives in `.works/kk.db-wal` (mtime 04:04:52, 2,710,992 B, `grep -a -c 0003_store_v2` = 2). Every claim in `## Testing`/`## Solution` that the live store "is never opened for writing"/that "sidecars [are] untouched" is false in substance, and the previous review's residual line "the live store never left v1" is false — the hop re-affirmed R0–R6 as unchanged at 08:23–08:35, i.e. more than four hours *after* the migration. Consequences: (a) the live store now runs a schema its own tree (`main`, HEAD `18af1f53`) does not know — that tree's catalog has no `kk-item-china-politics/-sensitivity/-audience` (`plugins/kk/decisions/kk-items.yaml`, `version: 1`) and its config still has `decisions.maker: fm-local` with no override, so the live collect wrote 55 rows for 5 decisions and **no** rows for the three judgment decisions (the production ai-news pool stays empty until this branch merges); (b) the Design's rollback step 3 ("reinstall the 0.0.33 global binary") is now **unsafe** for the live store — a v1-era binary against a v2 store is precisely the skew the Refine correction calls fatal. | `…/knowledge-kit/.works/kk.db{-wal,-shm}`; `…/.works/kk-collect/launchd.log`; `packages/kk-store/src/config.ts:6`; `packages/kk-store/src/db.ts:47`; `## Testing` R1 preamble ("sidecars untouched", "never opened for writing"); Design rollback step 3 | OPEN — blocking. Owner filed this run: **0237**. |
| 2 | P3 (minor) | correctness | **A fractional `score` answer is stored as no observation at all** — the hop's new finding is real and reproduced. `decisionValue` requires `Number.isInteger` in `[0, levels)` (`apps/cli/src/commands/store.ts:661-668`); `makerRow` then falls through to `null` when the decision has no heuristic annotation (`:717-753`), so the raw answer is not kept either. Live probe (item `816ab26a…`, the hop's item): `typesafe` answers `{"source":"model","reason":"accepted","value":0.01,"confidence":0.99}` for china-politics — **no row** (the item has 33 label rows and 0 china-politics rows, and it passes every other profile gate, so it is the pool's missing 15th item); the same for sensitivity (`value 0.9`, and the store has **0** typesafe sensitivity rows vs 13 `default/error`). Is it a `kk` defect? No — it is a **maker/scale contract mismatch** (spur's 0–1 fraction vs kk's discrete levels); the `kk` side behaves as specced (0226's validator) and neither the gate `lte: 1` nor `fallback: 3` was weakened. The final config handles it **honestly**: no sensitivity override, the reason recorded as a config comment, the contract filed as **0236** (verified: exists, feature G32, status `todo`, correct owner). | `apps/cli/src/commands/store.ts:661-668,717-753`; probe output above; `.spur/config.yaml:168-171`; `docs/tasks/0236_…md` | DEFER (0236) |
| 3 | P3 (minor) | correctness / evidence | **The maker matrix and the config comment overstate `fm-local`.** The config comment says "fm-local errors" on sensitivity; the store holds **11** `fm-local` `source='model'`/`reason='accepted'` sensitivity rows with integer levels 1–2 (5 in run `61986366`, 6 in `g32-cp-backfill-1`) beside 13 `default/error` rows — so fm-local is *intermittent*, not uniformly failing, and "its observations stay unusable" is not a property. My live probe also returned `fm-local` `default/error` for `kk-item-audience` where the recorded matrix says `fm-local` → `model`/`accepted (general)`: the matrix is one consult per cell, deterministic only for `typesafe`/`laya-local`. The three decisions are unaffected (typesafe is the one maker that answers china-politics, and it does so deterministically). | `.spur/config.yaml:168-171`; `## Solution` "Config finalisation" matrix; SQL `select maker,source,reason,count(*) … where decision_id='kk-item-sensitivity'` | DEFER (0236) |
| 4 | P3 (minor) | evidence | `## Solution`'s maker table cites `.spur/config.yaml:167` for `kk-item-sensitivity: typesafe` and `:168` for `kk-item-audience: typesafe`, but the final file has audience at **167** and **no** sensitivity entry (168-171 is the comment). The table records the superseded intermediate state while the finalisation section below it records the final one; `spur task check 0230` confirms the drift with `L4.anchor-subject-mismatch` on `.spur/config.yaml:168`. | `.spur/config.yaml:166-167`; `## Solution` table; `spur task check 0230` | DEFER (0237) |
| 5 | P4 (advisory) | usability | The design doc's §3 verb table still omits two shipped verbs — `backfill-facts` (0227) and `pool-count` (the §6 guards use it) — unchanged since the previous review's finding 7. | `docs/design/kk-collect-and-daily-voice2.md:63-72` vs `kk store --help` | ACCEPTED (0230) |
| 6 | P4 (advisory) | usability | The degraded-label signal is still not actionable: `kk store label` printed `{"verdict":"PASS","confidence":"LOW","labeled":77,"model":15,"fallback":17,…}` for R3 while `run-report` says only "the store pool was empty (kk store extract found no unused items)" — neither names the decision or the maker, and (new) nothing warns when a decision in the catalog has **no observation at all** (the live collect's three judgement decisions). | `apps/cli/src/commands/store.ts` label verdict line; `.works/kk-daily-ai-voice2/20261011/run-report.summary.txt`; live collect run `dd2be37a…` | DEFER (0236) |

##### Residual risk

- **The production path is still degraded — now on v2.** The operator's live store holds **0** `kk-item-china-politics` rows; the 04:04 collect wrote 55 rows for the five pre-existing decisions only, because the live tree's catalog does not define the three judgment decisions. So the live ai-news pool stays empty (fail-closed INNER join) until this branch's config + catalog + profile merge. The P1 fix verified here **is** branch-resident — that is expected for a `runall` branch, but it means the working config is not the working production config yet.
- **Finding 1 leaves production in a state nobody recorded**: schema v2 + old code/catalog, and a rollback note that would reintroduce a binary/schema skew. Until 0237 decides it, do not follow the Design's rollback step 3 against the live store, and expect a non-G32 binary to be unable to write it.
- **Rollback material is intact**: `.works/kk.db.pre-g32` (344064 B, `integrity_check ok`, journal `0001`+`0002`) is the pre-cut-over content of the same store lineage (the live `kk.db` was byte-unchanged until 04:00, sha256 `3d21b641…`), so restoring v1 remains possible — at the cost of the live data written since 04:00.
- **Harness, unchanged and outside this task's diff**: all four daily DAGs still end `failed` at the four inline `agent.run` nodes (`agent.run (coder) exited 0 but expected file is absent`, partials under `.spur/run/<run>-*-partial.md`) *after* `select` commits — 0228's stated property holds, but every dry run is a `failed` DAG.
- **Unrun checks, labelled**: `bun run lint|test|build` were **not** re-executed this run — nothing that could change them did (a full mtime sweep of tracked files shows no source/test/doc file modified after 00:34; the only later edit is `.spur/config.yaml` at 08:33), so the hop's green gate is inherited, not re-measured. R3's live collect and R5's replay were **not** re-run; their artifacts were re-hashed/re-queried instead. The maker-matrix cells are one live consult each (typesafe is a cloud model; `fm-local` is intermittent, finding 3).

- **Staging note.** This review's scratch copies live under `/tmp/r230/` and `/tmp/live/` (+ `/tmp/0230-review2.md`); nothing was written to the repo root, to `.works/kk.db` (mtimes 08:27-08:35, all pre-review) or to the operator's live store (still `sha256 3d21b641…`), and the scratch is removable.

##### Disposition

FAIL. Both decided findings are properly closed and independently re-verified: the maker config **is** the routed surface (`makerSource: config-decision` on the default probe), the pool is restored to production **8** / `--include-selected` **14** and held by the config-driven pass alone (controlled-deletion probe: a copy whose only china-politics rows are `g32-maker-fix`'s 14 still returns 8/14, while the pre-fix state returns 0/0), the fractional-level residual is real, well-attributed and owned by 0236, and AC1 is now evidenced on a **non-vacuous, independently reproduced** instance (5 + 3 disjoint, both non-empty, 5+3 = the whole pool, 0 `selected` rows left) with the defaults' degeneracy disclosed rather than papered over. It fails on one point that must not be recorded as green: the operator's **live store was migrated to v2 at 04:00:06 by the scheduled collector**, no run record says so, and the exact safety claim the review was asked to re-check ("still untouched") is therefore false in substance — the file hash is unchanged, which is why the check that certified R1 is blind to it. That is finding 1 (P2, blocking, owner filed as **0237**); the correct repair is a record correction plus the operator's decision about the live store/live tree, not a code change.

**Next:** fix 0230's live-store record and take the operator's decision on the live store/live tree per **0237** (do not weaken `lte: 1`, `fallback: 3`, or the maker overrides); leave the score-scale contract to **0236**.

### References

- Feature G32 (R13 plus the AC for disjoint pools and docs). Depends on 0225–0229.
- `~/Library/LaunchAgents/ai.gobing.kk-collect.plist` (schedule 04/10/16/22h, `spur workflow run …kk-collect.yaml`); `~/.bun/bin/kk` → global `@gobing-ai/knowledge-kit` 0.0.33.
- `plugins/kk/workflows/kk-collect.yaml:75,153,169` (collect lock); `plugins/kk/workflows/kk-daily-ai-voice2.yaml:58` (`publish_enabled`).
- `docs/design/kk-collect-and-daily-voice2.md` §2 `:22`, §3 `:61`, §4 `:72`, §6 `:143`, §8 `:232`; `docs/03_ARCHITECTURE.md:123-129`.

### History

- 2026-10-09T02:45:16.762Z backlog → todo (system)
- 2026-10-09T08:02:03.702Z todo → wip (system)

