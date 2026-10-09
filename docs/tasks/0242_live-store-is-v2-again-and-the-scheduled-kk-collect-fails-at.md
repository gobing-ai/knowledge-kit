---
schema_version: 1
name: "Live store is v2 again and the scheduled kk-collect fails at kk store label (ON CONFLICT mismatch): settle the store and green the collector"
status: todo
template: issue
created_at: 2026-10-09T17:41:35.203Z
updated_at: "2026-10-09T17:56:19.042Z"
feature_id: G32

priority: P1
ac_altitude: task-local
dependencies: ["0239", "0240"]
---

## 0242. Live store is v2 again and the scheduled kk-collect fails at kk store label (ON CONFLICT mismatch): settle the store and green the collector

### Background

Found while recording the 0241 incident. The operator's live store `.works/kk.db` is a v2 store, and the scheduled collector fails at `kk store label`.

**Root cause, verified on 2026-10-09 at 10:47 against a byte copy.** Two binaries wrote one store. `main` has no code defect.

- **Every step of the 10:00 tick ran 0.0.33.** The plist PATH puts `~/.bun/bin` first, and `~/.bun/bin/kk` links to `/Users/robin/node_modules/@gobing-ai/knowledge-kit/dist/index.js` (0.0.33; the symlink mtime is 08:42). That build contains no `0003_store_v2` (`grep -c` → 0). npm `latest` is also 0.0.33.
- **Something else migrated the store mid-run.** The journal shows `0003_store_v2` `applied_at 1791566167006` (10:16:07). The job's ingest wrote its `collect_runs` row at 10:16:08, and its 14 new items have `story_id IS NULL` and NULL facts. `0003` runs `UPDATE items SET story_id = id`, and v2 ingest computes `story_id`, so these rows were inserted after the migration by v1 code. The migrating process was some v2 build opening the store in this tree, most likely the repo build (`apps/cli/dist/index.js`, mtime 10:17) run by the concurrent merge session. That process is not proven, and the fix does not depend on it.
- **The failure itself.** The 0.0.33 `LabelsDao` upserts on `[labels.itemId, labels.decisionId]` (0.0.33 `dist/index.js:44145,44162`). `0003` dropped that unique index. The v2 store holds only `labels_observation_unique (item_id, decision_id, maker, run_id)`, so the v1 upsert raises `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`. `main`'s path targets the 4-column identity (`packages/kk-store/src/dao/labels.ts:249-259`) and matches the store.
- **The job and the shell already agree.** Both resolve `~/.bun/bin/kk`. The actual gap is that the global build is older than the store's schema, and nothing detects that. `applyKkMigrations` (`packages/kk-store/src/migrations.ts:296-341`) never checks for journal ids it does not know, so an old binary silently writes a newer store.

**Live-store damage.** Measured on a copy taken at 10:47:

- 92 items. 14 have no `story_id` or facts. 24 have no label rows.
- 340 labels, all legacy (`catalog_version IS NULL`): 325 heuristic, 9 model, 6 default. The 9 model rows can never be current (0239 R4).
- 0 rows for the three judgment decisions, so `kk store extract --topic ai-news` is empty.
- Every tick fails the same way until the global `kk` is v2. The failure is non-destructive: ingest still lands items and the lock is released.

**Correction to 0241's recovery note.** Opening `.works/incident-2026-10-09T0952/kk.db` in place reads its sibling `-wal` and shows the v2 state (`no such table: episode_usage`). The v1 file (68 items / 340 labels) is recoverable only by copying `kk.db` **without** its `-wal`/`-shm`.

### Requirements

- [ ] R1. **Schema-skew guard.** Before applying anything, `applyKkMigrations` (`packages/kk-store/src/migrations.ts:296`) must reject a store whose `__kk_store_migrations` holds an id missing from `KK_MIGRATIONS`. The error is `kk.store.schema-newer: <db> has migrations [<ids>] this kk (<version>) does not know — upgrade kk`, and the store is left untouched. This protects every binary from 0.0.34 on; 0.0.33 cannot be patched.
- [ ] R2. **Operator gate: the global `kk` becomes v2.** `~/.bun/bin/kk` must resolve to a build that contains 0225–0229, 0239, 0240 and R1, and `kk store --help` must list `select`/`mark-published`/`release`.
  - Recommended: release 0.0.34 through the CI publish (`scripts/publish.ts`), then `bun add -g @gobing-ai/knowledge-kit@0.0.34`.
  - Stop-gap: `bun link` from **this** tree's `apps/cli`. The job's cwd is this same tree, so code, catalog and config stay in lockstep. Never link a worktree build (0241).
  - Either option needs explicit operator authorization. Without it, the task stops as `blocked` after R1.
- [ ] R3. **Repair the live data under the collect lock.**
  1. `kk store lock acquire --name collect --run g32-repair`.
  2. `PRAGMA wal_checkpoint(TRUNCATE)`, then `cp .works/kk.db .works/kk.db.pre-0242`.
  3. `kk store backfill-facts`.
  4. `kk store label --run g32-relabel --new-ids <path to a JSON array of every item id>` (default `--mode heuristic`, the same mode the collector uses), which re-observes all 92 items under the v2 catalog and config.
  5. `kk store lock release --name collect --run g32-repair`.
  6. Verify: 0 items with NULL `story_id`, every item has a current china-politics label, and `kk store extract --topic ai-news` returns count > 0.
- [ ] R4. **One real `kk-collect` reaches `done`.** Use the next scheduled tick, or run `spur workflow run plugins/kk/workflows/kk-collect.yaml` from this tree. The run's new items carry label rows with its run id, plus `story_id` and facts.
- [ ] R5. **Record the settled state** in `docs/03_ARCHITECTURE.md`'s persistent-store paragraph:
  - the live store is on v2, and only the global `kk` writes it;
  - launchd resolves `kk` via the plist PATH (`~/.bun/bin` first), and an interactive shell resolves the same file;
  - **upgrade order:** a schema-bumping change reaches the live tree only together with a global `kk` that carries it, and R1 enforces this from now on;
  - the recovery paths: `.works/kk.db.pre-0242`, or the incident archive's `kk.db` copied without its `-wal`/`-shm` (v1, 68 items / 340 labels).

### Acceptance Criteria

- [ ] AC1 — On a store whose journal lists an id unknown to the binary, opening it fails with `kk.store.schema-newer` naming the ids, and the store bytes and journal are unchanged (req: R1).
- [ ] AC2 — `readlink -f ~/.bun/bin/kk` resolves to an operator-authorized v2 build, and `kk store --help` lists `select`, `mark-published` and `release` (req: R2).
- [ ] AC3 — After the repair, the live store has 0 NULL `story_id`, a current `kk-item-china-politics` label on every item, and a non-empty `kk store extract --topic ai-news` (req: R3).
- [ ] AC4 — A real `kk-collect` run reaches `done`, and its new items carry label rows with that run id (req: R4).
- [ ] AC5 — `docs/03_ARCHITECTURE.md` records the live store's schema, its writer, the upgrade-order rule and the recovery paths (req: R5).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-09 refine

- **Q: Is the failure a v2 code defect?** No. `main`'s labels upsert matches `labels_observation_unique`; the failing step was 0.0.33. Closed.
- **Q: Do the job and an interactive shell resolve different `kk` builds?** No. Both resolve `~/.bun/bin/kk`, which is 0.0.33. The real mismatch is binary vs. store schema. The old R3 was reframed as R2 (upgrade the global binary) plus R1 (detect the skew).
- **Q: Release or link?** The release is recommended, because the global then matches a published, reproducible artifact. A `bun link` from this tree is an acceptable stop-gap. Both are operator decisions, and the task blocks at R2 without one.
- **Q: Restore v1 instead?** Rejected. The store matches `main`, and a restore loses 24 items.

### Design

**No code fix for the collector itself.** `main`'s label path already matches the v2 store, and the failure is the 0.0.33 binary. The code change is the guard (R1), so the next skew fails at `lock acquire` with a named cause instead of half-writing a run.

**R1 shape.** At the top of `applyKkMigrations`, if the journal table exists, read its ids. Any id missing from `migrations` throws before the `allMigrationsJournaled` short-circuit and before any DDL. Read the version string from the CLI package the way `kk --version` does; if threading it through costs more than a parameter, leave it out of the message. Test in `packages/kk-store/tests/migrations.test.ts`: journal a fake `9999_future` id, call `openStore`, assert the rejection, and assert that the journal still holds exactly the original ids.

**Why relabel everything (R3), not just the 24 unlabelled items.** All 68 legacy items lack the three judgment decisions, which the v1 catalog did not define. The ai-news profile's china-politics gate is a fail-closed INNER join, so without a relabel the pool stays empty. The relabel also supersedes the 9 evidence-less legacy model rows (0239 R4 decides they stay ineligible). Cost reference: 15 items took 45 consults in 13.7 s under the current config (0230 Testing), so 92 items is a few minutes.

**Do not rebuild or restore the store.** It is consistent with `main`. A restore would lose the 24 items ingested since the incident.

**Order.** 0239 and 0240 land first, because the release must carry them:

1. R1 (code + test).
2. R2 (operator gate, then release/install).
3. R3 (repair).
4. R4 (collect).
5. R5 (docs).

0239 R1 edits `0003`'s SQL, which is legal only while `0003` is unreleased.

**Anti-patterns:**

- Linking a worktree build globally.
- Running R3 without the lock and the backup.
- Restoring from the archive while it still has its `-wal` beside it.
- Weakening the china-politics gate (`lte: 1`) or its `fallback: 3` to make the pool non-empty.

### Plan

1. R1: write the guard test (fake future journal id → rejected, store unchanged), then implement the guard in `applyKkMigrations`. Run `bun run gate`.
2. Confirm that 0239 and 0240 are merged. Ask the operator for R2 (release 0.0.34 + `bun add -g`, or the in-tree `bun link`). Verify with `readlink -f ~/.bun/bin/kk` and `kk store --help`.
3. R3: lock → checkpoint + backup → `backfill-facts` → full relabel → release. Record the before/after SQL counts and the extract count in Testing.
4. R4: run one collect, or wait for the next tick, and record its run id and its rows by SQL.
5. R5: write the persistent-store paragraph. Run `bun run gate` and `spur task check 0242`.

### Root Cause

Verified. The 10:00 tick ran 0.0.33 for every step (`~/.bun/bin/kk` → `/Users/robin/node_modules/@gobing-ai/knowledge-kit/dist/index.js`, which has no `0003_store_v2`). A v2 build opened the same cwd-relative store at 10:16:07 (journal `applied_at 1791566167006`) and applied `0003`, which dropped the `(item_id, decision_id)` unique index. The 0.0.33 label upsert still targets that index (0.0.33 `dist/index.js:44145,44162`), and that produces the exact error in `.works/kk-collect/launchd.log:294`.

Contributing gap: `applyKkMigrations` (`packages/kk-store/src/migrations.ts:296`) never detects a journal that is newer than the binary, so the skew surfaced as a SQL error deep in the label step rather than at open. Not established, and immaterial to the fix: which process opened the store at 10:16:07.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Failure log: `.works/kk-collect/launchd.log` (newest run `54b2c6d7-dfe5-43d7-a87d-62100542093f`).
- Workflow: `plugins/kk/workflows/kk-collect.yaml` (steps at `:58`, `:75`, `:94` invoke bare `kk`).
- Store: `.works/kk.db` (journal `0003_store_v2`); recovery file `.works/incident-2026-10-09T0952/kk.db`.
- Code: `packages/kk-store/src/dao/labels.ts` (the observation upsert), `packages/kk-store/src/dao/items.ts`
  (the ingest upsert), `packages/kk-store/src/migrations.ts:187-205`.
- Related: 0241 (the incident record), 0238 (the daily voice2 DAG's agent nodes), `docs/tasks/0226_*.md`
  (the label pass), `docs/tasks/0208_*.md` / G31 (the collector).

### History
