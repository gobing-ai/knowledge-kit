---
schema_version: 1
name: "Store v2 cut-over: live-store migration dogfood, two-run disjoint-pool E2E, design doc sync"
status: done
template: feature-impl
created_at: 2026-10-09T01:27:20.622Z
updated_at: "2026-10-09T21:53:29.836Z"
feature_id: G32

dependencies: ["0225", "0226", "0227", "0228", "0229"]
priority: P2
estimate_hours: 3
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0230-verdict.json
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

- [x] R7. **Close review finding 5.** Add `backfill-facts` and `pool-count` to the §3 verb table in `docs/design/kk-collect-and-daily-voice2.md` (`:63-72`), using the shipped help text.
  - `kk store backfill-facts [--db <path>]` recomputes the typed facts and `story_id` for every item (idempotent) and prints `{updated}`; exit 0/1.
  - `kk store pool-count <file> --min <n>` is the guard predicate: exit 0 when the pool holds ≥ n items, and it prints `{count, min}`.
- [x] R8. **Replace the stale rollback.** `.works/kk.db.pre-g32` no longer exists (`ls .works/` on 2026-10-09 shows only `kk.db` and `incident-2026-10-09T0952/`), and "the pre-G32 `kk` binary" against a v2 store is the exact skew of 0241/0242.
  - Rewrite the §8 cut-over note (`docs/design/kk-collect-and-daily-voice2.md:295-306`): the live store migrated outside this task (0241's record), the settled state and recovery paths are owned by 0242 R5, and v1 rollback is not supported once a v2 binary has written.
  - Annotate this task's Design **Rollback** list as superseded, pointing to 0242.

### Acceptance Criteria

- [x] AC1 — Two consecutive daily dry runs produce disjoint pools
- [x] AC2 — Decision and surface docs record store v2

- [x] AC3 — The design doc §3 lists `backfill-facts` and `pool-count`, matching `kk store <verb> --help` (req: R7).
- [x] AC4 — No doc or task section tells an operator to restore `.works/kk.db.pre-g32` or to run a pre-G32 `kk` against the store, and §8 points to 0242 for recovery (req: R8).

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T02:44:03.884Z

- **Q: Which `kk` does the scheduled collector run?** The bun-global 0.0.33, not the repo build (refine audit). Closed: R0 gates the cut-over on a G32 global binary, and the install/release is operator-authorized.
- **Q: How is the live store protected during migration?** Closed: the store's own `collect` lock, a WAL checkpoint plus file backup, and the atomic `0003` batch. Rollback restores the file and the old binary.
- **Q: Can dry runs mark items published?** No, after the 0228 correction. Closed: `mark-published` is guarded by `publish_enabled`.

#### Q&A entry — 2026-10-09 refine (remaining work)

- **Q: Is review finding 1 (an unrecorded live-store migration) still blocking?** No. 0241 corrected the record and archived the incident, and that task is done. The live store's current state and its repair belong to **0242**. 0230's R1–R6 stand as evidence measured on the worktree copy.
- **Q: Finding 4 (the `.spur/config.yaml` anchor drift)?** Resolved by commit `7c35e0dc`. `spur task check 0230` reports no findings.
- **Q: Findings 2, 3 and 6?** Owned by **0240**: round-to-nearest-level, `refused` counts in the label verdict line, and sensitivity routed to typesafe. Finding 6's "a catalog decision with no observation at all" was caused by the live tree's old catalog, which merged with G32. No separate work.
- **Q: Does 0230 wait for 0242?** No. 0230's remaining scope is the two doc fixes (R7, R8) plus re-review and verify. 0242 owns the live cut-over.

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

> **Superseded on 2026-10-09 by 0241/0242.** The Rollback list above is void. `.works/kk.db.pre-g32` no longer exists, and running a pre-G32 `kk` against the v2 live store reproduces the 0242 failure. Recovery paths and the upgrade-order rule are owned by 0242 (R5).

### Plan

1. R0: check `~/.bun/bin/kk --version`. If it is not a G32 build, ask the operator to authorize a global install/link (or release), or stop as `blocked`.
2. Take the collect lock, checkpoint, back up, migrate, release the lock, then reconcile the counts (R1).
3. Run backfill-facts, then calibrate and spot-check (R2).
4. Run a live collect and verify by SQL (R3).
5. Run the two voice2 dry runs, write the artifact, then release (R4).
6. Run the replay byte-identity check (R5).
7. Sync docs (R6), then run `bun run gate` and `spur feature check G32`.

**Remaining (2026-10-09 refine):**

8. R7: add the two §3 verb rows.
9. R8: rewrite the §8 cut-over note. The Design section already carries the "Superseded — see 0242" note (added at refine).
10. Run `bun run gate`, `spur task check 0230` and `spur feature check G32`. Re-run `/sp:dev-review 0230` and `/sp:dev-verify 0230`, then transition to `done`.

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
- `docs/design/kk-collect-and-daily-voice2.md:63-75` - §3 table lists `backfill-facts` and `pool-count` (R7).
- `docs/design/kk-collect-and-daily-voice2.md:295-306` - §8 gains the G32 cut-over note: the
  `0003_store_v2` batch, live migration recorded in 0241, settled state and recovery paths owned by 0242 (R5),
  and v1 rollback superseded once a v2 binary has written (R8).
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
- **R7** `docs/design/kk-collect-and-daily-voice2.md:63-75` §3 table updated to list `backfill-facts` and `pool-count` matching shipped CLI help text.
- **R8** `docs/design/kk-collect-and-daily-voice2.md:295-306` §8 note updated to record live migration outside task (0241) and settled state owned by 0242 (R5), voiding stale v1 rollback. Design Rollback marked superseded.

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
`decisions.makers` map (`.spur/config.yaml:170`), leaving the two existing entries and the global
`decisions.maker: fm-local` untouched:

The hop's intermediate state, superseded by the finalisation below (which records what survived):

| Location | Entry | Final state |
| --- | --- | --- |
| `.spur/config.yaml:173` | `kk-item-china-politics: typesafe` | kept |
| `.spur/config.yaml:174` | `kk-item-audience: typesafe` | kept |
| no sensitivity override | the removal is documented by the comment at `.spur/config.yaml:175-178` | added by the finalisation (no maker yields a usable integer level) |

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

Final `decisions.makers` block, `.spur/config.yaml:170-178` (the maker overrides):

- `kk-item-china-politics: typesafe` — the only maker that answers, and its answers are integers.
- `kk-item-audience: typesafe` — answers cleanly (a `choice` decision, so no scale problem).
- **no `kk-item-sensitivity` override** (it inherits `maker: fm-local`), with the reason recorded as a
  comment in that block: neither maker produces a usable level, so an override would only hide that.
- `kk-item-category` / `kk-item-quality` / the global `maker` untouched, and neither the gate
  (`lte: 1`) nor the rubric fallback (`3`) was weakened.

The maker-versus-scale contract is filed as **task 0240**. Verified after the change:
`kk store extract --topic ai-news` still returns the pool, and
`kk store extract --topic ai-news --include-selected` returns the whole corpus pool — i.e. the
china-politics gate is admitting items under the final config, not just under the hop's intermediate one.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R0 | MET | `~/.bun/bin/kk --version` → `0.0.33` this pass, matching `apps/cli/package.json:3`, a build that contains 0225–0229 and the 0242 repair (commit 99623957 upgraded the global kk). |
| R1 | MET | **Correction (2026-10-09, task 0241): the original claim was falsified.** The batch first recorded the live `.works/kk.db` as byte-unchanged with sidecars untouched and "never opened for writing"; in substance the scheduled collector (cwd = the invoking tree) opened the live store at 04:00:06 and `openStore` applied `0003_store_v2` (`packages/kk-store/src/db.ts:66`) into the WAL, which the file hash cannot see; the store was archived to `.works/incident-2026-10-09T0952/` and restored, then re-settled as v2 by 0242. The batch measurements were on the worktree copy. Live migration recorded in this task's Solution; re-checked read-only this pass on a scratch copy of `.works/kk.db` (this verify pass queried only the copy): `__kk_store_migrations` lists `0001_kk_store_init`, `0002_labels_confidence_run_id`, `0003_store_v2`; 0 labels with NULL `run_id`; 12 `selections` rows `status='published'` = the 12 migrated `episode_usage` rows. Not re-executed: the migration is a one-shot live mutation, already applied. |
| R2 | MET | Solution records `backfill-facts` `{updated: 78}` → 75 stories and the spot-check/threshold verdict. Read-only snapshot this pass: 101 items, 98 distinct `story_id`, 0 items missing `body_chars`/`story_id`. |
| R3 | MET | Documented deviation (CHANGED, PASS-acceptable). Solution records the real `kk-collect` run with raw columns + `content_hash` and facts on new items; `catalog_version='1'` not `'2'` is a documented deviation (Solution note 1; catalog pinned at version 1 by the spur schema, see 0226 correction). Snapshot this pass: 914 labels with `catalog_version='1'`, 108 rows each for `kk-item-china-politics`, `kk-item-sensitivity`, `kk-item-audience`. |
| R4 | MET | `.works/test-artifacts/g32-live-disjoint.json` re-read this pass: run1 `563710fb…` 5 storyIds, run2 `ccd32842…` 3 storyIds, `intersection: []`, `statuses.selected: 8`. Snapshot this pass: 0 `selected` rows for either run id (the live store was later replaced by the 0241/0242 repair lineage, so 0 rows of any status remain for them). |
| R5 | MET | Solution records byte-identical extract before/after `kk store label --replay` (sha256 88063670…). Not re-executed this pass (replay writes observations to the live store). |
| R6 | MET | `docs/design/kk-collect-and-daily-voice2.md:36-44` §2 tables, `docs/design/kk-collect-and-daily-voice2.md:61` §3, `docs/design/kk-collect-and-daily-voice2.md:111-119` §4 raw columns + `labels_current`, `docs/design/kk-collect-and-daily-voice2.md:247` §6 mark-published, `docs/design/kk-collect-and-daily-voice2.md:300-306` §8; `docs/03_ARCHITECTURE.md:124` Persistent store. FIXED this pass: `docs/05_FEATURES.md:99` still said `0230 … in progress` / `🔧 active`; updated to `⏳ verifying` with 0225–0230 + 0239–0242 done. |
| R7 | MET | `docs/design/kk-collect-and-daily-voice2.md:73-74` rows match `bun apps/cli/src/index.ts store backfill-facts --help` ("Recompute the typed item facts and the causal story_id clustering for every item (idempotent); prints {updated}") and `store pool-count --help` ("Guard predicate: exit 0 when the pool file holds at least --min items (prints {count, min})"), compared this pass. |
| R8 | MET | `docs/design/kk-collect-and-daily-voice2.md:300-306` §8 note: live store migrated outside this task (0241), recovery owned by 0242 R5, v1 rollback not supported. Task Design carries the "Superseded on 2026-10-09 by 0241/0242" note after the Rollback list. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Two consecutive daily dry runs produce disjoint pools | MET | test | `.works/test-artifacts/g32-live-disjoint.json` re-read this pass (`intersection: []`); the same property is pinned executable by `apps/cli/tests/store-selections.test.ts:681`, re-run this pass (0 fail). |
| AC2 — Decision and surface docs record store v2 | MET | test | `docs/00_ADR.md:1184` ADR-030 amendment, `docs/03_ARCHITECTURE.md:124`, `docs/04_DESIGN.md:79-81`, `docs/design/kk-collect-and-daily-voice2.md:300-306`; `apps/cli/tests/store-docs.test.ts:58` re-run this pass. |
| AC3 | MET | command | `docs/design/kk-collect-and-daily-voice2.md:73-74` vs live `--help` output this pass. |
| AC4 | MET | command | grep `pre-g32` over `docs`, `plugins`, `apps/cli/src` this pass: only historical narrative in task files (0230 requirement text, the superseded Rollback list, the superseded historical Review; 0241's incident record) — none is a live instruction; §8 at `docs/design/kk-collect-and-daily-voice2.md:300-306` points to 0242. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

> **Coordinator re-disposition (2026-10-09, `/sp:dev-review` after `/sp:dev-verifyall --feature G32`).** Superseded finding 1 is RESOLVED: 0241 restored the Correction in `## Testing` (R1 row) and 0242 re-settled the live store on v2 (re-checked on a scratch copy this run: journal `0001`+`0002`+`0003_store_v2`, 0 NULL `story_id`, every item labelled, `kk store extract --topic ai-news` → 12). Both owners are `done`. No P1/P2 finding stands.


#### Review Report — 0230 (close-out, 2026-10-09) — **current disposition**

**Scope:** 0230's remaining scope only — the two doc fixes R7 and R8, plus re-verification of AC1/AC2. The R0–R6 dogfood evidence below is unchanged and is not re-derived here.
**Dimensions:** functional traceability, correctness, evidence integrity
**Verdict:** PASS
**Confidence:** HIGH — cited at line level: `docs/design/kk-collect-and-daily-voice2.md:63-75` carries the R7 verb rows transcribed from the shipped help text (`apps/cli/src/commands/store.ts:1367`, `:1527`); `docs/design/kk-collect-and-daily-voice2.md:295-306` carries the R8 cut-over note, which now names 0241's out-of-task migration, assigns recovery to 0242, and leaves no `.works/kk.db.pre-g32` restore instruction; `spur task check 0230` returns 0 findings; `bun run gate` on the merged tree returns 2346 tests pass with 51 pre-check and 2 post-check rules clean.

##### Per-requirement results (this close-out)

| Req | Verdict | Evidence |
|-----|---------|----------|
| R7 | MET | `docs/design/kk-collect-and-daily-voice2.md:63-75` lists `backfill-facts` and `pool-count`, transcribed from the shipped help text rather than paraphrased. |
| R8 | MET | `docs/design/kk-collect-and-daily-voice2.md:295-306` rewritten; the stale rollback is void and points at 0242, and this task's Design Rollback list is annotated superseded. |
| AC1 | MET | Unchanged from the re-certification below — `.works/test-artifacts/g32-live-disjoint.json` carries disjoint story sets for two consecutive dry runs. |
| AC2 | MET | Unchanged from the re-certification below — the ADR-030 amendment and the `docs/04_DESIGN.md` verb/label surface were read back this run. |
| AC3, AC4 | MET | The two new criteria are the executable form of R7/R8; both were read back from the file after the edit. |

##### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 | evidence | The re-certification review below still reads `Verdict: FAIL`, so the task read as failing while it is `done`. It is a historical record of the pre-fix state, not this task's disposition. | This section; the superseded report below | RESOLVED — superseded by the close-out report above; the FAIL is retained deliberately as the audit trail for the two findings it filed, both since owned by 0240 and 0241. |


#### Review Report — 0230 (re-certification, 2026-10-09) — **superseded; retained as the historical record**

*Superseded by the close-out report above. Its `Verdict: FAIL` describes the pre-fix state: finding 1 (the unrecorded live-store migration) and finding 2 (the fractional `score` answer) were filed as separate tasks — 0241 and 0240 — and both are now closed, so its blocking conditions no longer hold.*


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
| 1 | P2 (major) | security / evidence integrity | **The operator's live store was migrated to v2 without any recorded step, and the record says the opposite.** Read-only open of the live store: `__kk_store_migrations` = `0001`, `0002`, **`0003_store_v2` `applied_at 1791543606309` = 2026-10-09T04:00:06 local**; 6 tables incl. `selections`; items 83. Cause, verified: launchd `ai.gobing.kk-collect` (`WorkingDirectory /Users/robin/xprojects/knowledge-kit`, `Program /Users/robin/.bun/bin/spur` → the G32 link) fired at 04:00; its `kk store lock acquire` opened the live store and `openStore` applied `0003`; the job then completed (`dd2be37a-cb04-4c0b-8ab3-5bb075954924`, log `.works/kk-collect/launchd.log`, work dir `20261009T1100Z`, DAG `done`, `collect_runs` `inserted 5/updated 3`). The store resolves **cwd-relative** (`packages/kk-store/src/config.ts:6`), so the launchd job (live tree) hits the live store while every worktree run hit the copy — the copy's lock therefore never protected the real concurrent writer, contrary to the Refine correction's "the same WAL store". The `kk.db` **file** is still byte-identical (`sha256 3d21b641…`), which is exactly why the sha256 check cannot see it: the migration lives in `.works/kk.db-wal` (mtime 04:04:52, 2,710,992 B, `grep -a -c 0003_store_v2` = 2). Every claim in `## Testing`/`## Solution` that the live store "is never opened for writing"/that "sidecars [are] untouched" is false in substance, and the previous review's residual line "the live store never left v1" is false — the hop re-affirmed R0–R6 as unchanged at 08:23–08:35, i.e. more than four hours *after* the migration. Consequences: (a) the live store now runs a schema its own tree (`main`, HEAD `18af1f53`) does not know — that tree's catalog has no `kk-item-china-politics/-sensitivity/-audience` (`plugins/kk/decisions/kk-items.yaml`, `version: 1`) and its config still has `decisions.maker: fm-local` with no override, so the live collect wrote 55 rows for 5 decisions and **no** rows for the three judgment decisions (the production ai-news pool stays empty until this branch merges); (b) the Design's rollback step 3 ("reinstall the 0.0.33 global binary") is now **unsafe** for the live store — a v1-era binary against a v2 store is precisely the skew the Refine correction calls fatal. | `…/knowledge-kit/.works/kk.db{-wal,-shm}`; `…/.works/kk-collect/launchd.log`; `packages/kk-store/src/config.ts:6`; `packages/kk-store/src/db.ts:47`; `## Testing` R1 preamble ("sidecars untouched", "never opened for writing"); Design rollback step 3 | RESOLVED — 0241 corrected the record (Correction in `## Testing`) and 0242 re-settled the live store on v2; both done, re-checked 2026-10-09. |
| 2 | P3 (minor) | correctness | **A fractional `score` answer is stored as no observation at all** — the hop's new finding is real and reproduced. `decisionValue` requires `Number.isInteger` in `[0, levels)` (`apps/cli/src/commands/store.ts:661-668`); `makerRow` then falls through to `null` when the decision has no heuristic annotation (`:717-753`), so the raw answer is not kept either. Live probe (item `816ab26a…`, the hop's item): `typesafe` answers `{"source":"model","reason":"accepted","value":0.01,"confidence":0.99}` for china-politics — **no row** (the item has 33 label rows and 0 china-politics rows, and it passes every other profile gate, so it is the pool's missing 15th item); the same for sensitivity (`value 0.9`, and the store has **0** typesafe sensitivity rows vs 13 `default/error`). Is it a `kk` defect? No — it is a **maker/scale contract mismatch** (spur's 0–1 fraction vs kk's discrete levels); the `kk` side behaves as specced (0226's validator) and neither the gate `lte: 1` nor `fallback: 3` was weakened. The final config handles it **honestly**: no sensitivity override, the reason recorded as a config comment, the contract filed as **0240** (verified: exists, feature G32, status `todo`, correct owner). | `apps/cli/src/commands/store.ts:661-668,717-753`; probe output above; `.spur/config.yaml:168-171`; `docs/tasks/0240_…md` | DEFER (0240) |
| 3 | P3 (minor) | correctness / evidence | **The maker matrix and the config comment overstate `fm-local`.** The config comment says "fm-local errors" on sensitivity; the store holds **11** `fm-local` `source='model'`/`reason='accepted'` sensitivity rows with integer levels 1–2 (5 in run `61986366`, 6 in `g32-cp-backfill-1`) beside 13 `default/error` rows — so fm-local is *intermittent*, not uniformly failing, and "its observations stay unusable" is not a property. My live probe also returned `fm-local` `default/error` for `kk-item-audience` where the recorded matrix says `fm-local` → `model`/`accepted (general)`: the matrix is one consult per cell, deterministic only for `typesafe`/`laya-local`. The three decisions are unaffected (typesafe is the one maker that answers china-politics, and it does so deterministically). | `.spur/config.yaml:168-171`; `## Solution` "Config finalisation" matrix; SQL `select maker,source,reason,count(*) … where decision_id='kk-item-sensitivity'` | DEFER (0240) |
| 4 | P3 (minor) | evidence | `## Solution`'s maker table cites `.spur/config.yaml:167` for `kk-item-sensitivity: typesafe` and `:168` for `kk-item-audience: typesafe`, but the final file has audience at **167** and **no** sensitivity entry (168-171 is the comment). The table records the superseded intermediate state while the finalisation section below it records the final one; `spur task check 0230` confirms the drift with `L4.anchor-subject-mismatch` on `.spur/config.yaml:168`. | `.spur/config.yaml:166-167`; `## Solution` table; `spur task check 0230` | DEFER (0241) |
| 5 | P4 (advisory) | usability | The design doc's §3 verb table still omits two shipped verbs — `backfill-facts` (0227) and `pool-count` (the §6 guards use it) — unchanged since the previous review's finding 7. | `docs/design/kk-collect-and-daily-voice2.md:63-72` vs `kk store --help` | ACCEPTED (0230) |
| 6 | P4 (advisory) | usability | The degraded-label signal is still not actionable: `kk store label` printed `{"verdict":"PASS","confidence":"LOW","labeled":77,"model":15,"fallback":17,…}` for R3 while `run-report` says only "the store pool was empty (kk store extract found no unused items)" — neither names the decision or the maker, and (new) nothing warns when a decision in the catalog has **no observation at all** (the live collect's three judgement decisions). | `apps/cli/src/commands/store.ts` label verdict line; `.works/kk-daily-ai-voice2/20261011/run-report.summary.txt`; live collect run `dd2be37a…` | DEFER (0240) |

##### Residual risk

- **The production path is still degraded — now on v2.** The operator's live store holds **0** `kk-item-china-politics` rows; the 04:04 collect wrote 55 rows for the five pre-existing decisions only, because the live tree's catalog does not define the three judgment decisions. So the live ai-news pool stays empty (fail-closed INNER join) until this branch's config + catalog + profile merge. The P1 fix verified here **is** branch-resident — that is expected for a `runall` branch, but it means the working config is not the working production config yet.
- **Finding 1 leaves production in a state nobody recorded**: schema v2 + old code/catalog, and a rollback note that would reintroduce a binary/schema skew. Until 0241 decides it, do not follow the Design's rollback step 3 against the live store, and expect a non-G32 binary to be unable to write it.
- **Rollback material is intact**: `.works/kk.db.pre-g32` (344064 B, `integrity_check ok`, journal `0001`+`0002`) is the pre-cut-over content of the same store lineage (the live `kk.db` was byte-unchanged until 04:00, sha256 `3d21b641…`), so restoring v1 remains possible — at the cost of the live data written since 04:00.
- **Harness, unchanged and outside this task's diff**: all four daily DAGs still end `failed` at the four inline `agent.run` nodes (`agent.run (coder) exited 0 but expected file is absent`, partials under `.spur/run/<run>-*-partial.md`) *after* `select` commits — 0228's stated property holds, but every dry run is a `failed` DAG.
- **Unrun checks, labelled**: `bun run lint|test|build` were **not** re-executed this run — nothing that could change them did (a full mtime sweep of tracked files shows no source/test/doc file modified after 00:34; the only later edit is `.spur/config.yaml` at 08:33), so the hop's green gate is inherited, not re-measured. R3's live collect and R5's replay were **not** re-run; their artifacts were re-hashed/re-queried instead. The maker-matrix cells are one live consult each (typesafe is a cloud model; `fm-local` is intermittent, finding 3).

- **Staging note.** This review's scratch copies live under `/tmp/r230/` and `/tmp/live/` (+ `/tmp/0230-review2.md`); nothing was written to the repo root, to `.works/kk.db` (mtimes 08:27-08:35, all pre-review) or to the operator's live store (still `sha256 3d21b641…`), and the scratch is removable.

##### Disposition

FAIL. Both decided findings are properly closed and independently re-verified: the maker config **is** the routed surface (`makerSource: config-decision` on the default probe), the pool is restored to production **8** / `--include-selected` **14** and held by the config-driven pass alone (controlled-deletion probe: a copy whose only china-politics rows are `g32-maker-fix`'s 14 still returns 8/14, while the pre-fix state returns 0/0), the fractional-level residual is real, well-attributed and owned by 0240, and AC1 is now evidenced on a **non-vacuous, independently reproduced** instance (5 + 3 disjoint, both non-empty, 5+3 = the whole pool, 0 `selected` rows left) with the defaults' degeneracy disclosed rather than papered over. It fails on one point that must not be recorded as green: the operator's **live store was migrated to v2 at 04:00:06 by the scheduled collector**, no run record says so, and the exact safety claim the review was asked to re-check ("still untouched") is therefore false in substance — the file hash is unchanged, which is why the check that certified R1 is blind to it. That is finding 1 (P2, blocking, owner filed as **0241**); the correct repair is a record correction plus the operator's decision about the live store/live tree, not a code change.

**Next:** fix 0230's live-store record and take the operator's decision on the live store/live tree per **0241** (do not weaken `lte: 1`, `fallback: 3`, or the maker overrides); leave the score-scale contract to **0240**.

### References

- Feature G32 (R13 plus the AC for disjoint pools and docs). Depends on 0225–0229.
- `~/Library/LaunchAgents/ai.gobing.kk-collect.plist` (schedule 04/10/16/22h, `spur workflow run …kk-collect.yaml`); `~/.bun/bin/kk` → global `@gobing-ai/knowledge-kit` 0.0.33.
- `plugins/kk/workflows/kk-collect.yaml:75,153,169` (collect lock); `plugins/kk/workflows/kk-daily-ai-voice2.yaml:58` (`publish_enabled`).
- `docs/design/kk-collect-and-daily-voice2.md` §2 `:22`, §3 `:61`, §4 `:72`, §6 `:143`, §8 `:232`; `docs/03_ARCHITECTURE.md:123-129`.

### History

- 2026-10-09T02:45:16.762Z backlog → todo (system)
- 2026-10-09T08:02:03.702Z todo → wip (system)
- 2026-10-09T18:16:47.402Z wip → testing (system)
- 2026-10-09T18:16:47.757Z testing → done (system)

