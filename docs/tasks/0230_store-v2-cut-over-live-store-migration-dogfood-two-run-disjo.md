---
schema_version: 1
name: "Store v2 cut-over: live-store migration dogfood, two-run disjoint-pool E2E, design doc sync"
status: todo
template: feature-impl
created_at: 2026-10-09T01:27:20.622Z
updated_at: "2026-10-09T02:45:16.762Z"
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

- [ ] R0. **Cut-over gate (operator-authorized).** `~/.bun/bin/kk --version` reports a build that contains 0225–0229, either a released version installed globally or `bun link` from `apps/cli`. Changing the operator's global binary or releasing needs explicit operator authorization. Without it, this task stops here as `blocked`, names the step, and leaves the live store untouched.
- [ ] R1. Acquire the collect lock: `kk store lock acquire --name collect --run g32-cutover --ttl 3600000`. It must print `{acquired}`; `{skipped}` means a collect is running, so wait and retry.
  - Back up: `cp .works/kk.db .works/kk.db.pre-g32`, plus the `-wal`/`-shm` files if present, after a `PRAGMA wal_checkpoint(TRUNCATE)`.
  - Then run `kk store migrate`, then `kk store lock release --name collect --run g32-cutover`.
  - Record the counts before and after in Testing:
    - items unchanged;
    - labels row count unchanged, with every row's `run_id` non-null;
    - `episode_usage` rows = `selections` rows with `status='published'`;
    - the journal lists `0003_store_v2`.
- [ ] R2. Run `kk store backfill-facts`. Record the `{updated}` count, the number of distinct `story_id`s vs items, and a spot-check of 10 multi-member clusters (merged correctly or not). Record the threshold verdict for U2.
- [ ] R3. Run one real `kk-collect`: `spur workflow run plugins/kk/workflows/kk-collect.yaml`. Confirm by SQL that the new observations carry `raw_value`/`raw_confidence`/`reason`/`duration_ms`/`catalog_version='2'` and `content_hash`, that the three new decisions are present, and that new items have facts and `story_id`.
- [ ] R4. Run `kk-daily-ai-voice2` twice with the default `publish_enabled=false`, under distinct run ids. The second run's `selections` (topic `ai-news`) share no `story_id` with the first's. Write `.works/test-artifacts/g32-live-disjoint.json` in the shape `{run1:{run,storyIds}, run2:{run,storyIds}, intersection:[], statuses:{selected:n}}`. Then `kk store release --run` both runs and confirm 0 `selected` rows remain for them.
- [ ] R5. Capture `kk store extract --topic ai-news --include-selected --out a.json`. Run `kk store label --replay since:24h --maker <a maker not in store.labels.priority>`, re-extract to `b.json`, and confirm the two are byte-identical. Record the replay `{replayed, consults}`.
- [ ] R6. Sync docs:
  - design doc `docs/design/kk-collect-and-daily-voice2.md`: §2 tables, §3 verbs, §4 labels/confidence (raw columns, `labels_current`, priority/threshold), §6 (`select` / `mark-published` nodes), §8 cut-over note;
  - `docs/03_ARCHITECTURE.md` "Persistent store" paragraph (`:123-129`);
  - `docs/05_FEATURES.md` G32 status.

  Then run `spur feature check G32`.

### Acceptance Criteria

- [ ] AC1 — Two consecutive daily dry runs produce disjoint pools
- [ ] AC2 — Decision and surface docs record store v2

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature G32 (R13 plus the AC for disjoint pools and docs). Depends on 0225–0229.
- `~/Library/LaunchAgents/ai.gobing.kk-collect.plist` (schedule 04/10/16/22h, `spur workflow run …kk-collect.yaml`); `~/.bun/bin/kk` → global `@gobing-ai/knowledge-kit` 0.0.33.
- `plugins/kk/workflows/kk-collect.yaml:75,153,169` (collect lock); `plugins/kk/workflows/kk-daily-ai-voice2.yaml:58` (`publish_enabled`).
- `docs/design/kk-collect-and-daily-voice2.md` §2 `:22`, §3 `:61`, §4 `:72`, §6 `:143`, §8 `:232`; `docs/03_ARCHITECTURE.md:123-129`.

### History

- 2026-10-09T02:45:16.762Z backlog → todo (system)

