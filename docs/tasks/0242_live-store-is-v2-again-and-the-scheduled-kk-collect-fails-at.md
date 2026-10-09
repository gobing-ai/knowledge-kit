---
schema_version: 1
name: "Live store is v2 again and the scheduled kk-collect fails at kk store label (ON CONFLICT mismatch): settle the store and green the collector"
status: done
template: issue
created_at: 2026-10-09T17:41:35.203Z
updated_at: "2026-10-09T21:53:35.564Z"
feature_id: G32

priority: P1
ac_altitude: task-local
dependencies: ["0239", "0240"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0242-verdict.json
---

## 0242. Live store is v2 again and the scheduled kk-collect fails at kk store label (ON CONFLICT mismatch): settle the store and green the collector

### Background

Found while recording the 0241 incident. The operator's live store `.works/kk.db` is a v2 store, and the scheduled collector fails at `kk store label`.

**Root cause, verified on 2026-10-09 at 10:47 against a byte copy.** Two binaries wrote one store. `main` has no code defect.

- **Every step of the 10:00 tick ran 0.0.33.** The plist PATH puts `~/.bun/bin` first, and `~/.bun/bin/kk` links to `/Users/robin/node_modules/@gobing-ai/knowledge-kit/dist/index.js` (0.0.33; the symlink mtime is 08:42). That build contains no `0003_store_v2` (`grep -c` → 0). npm `latest` is also 0.0.33.
- **Something else migrated the store mid-run.** The journal shows `0003_store_v2` `applied_at 1791566167006` (10:16:07). The job's ingest wrote its `collect_runs` row at 10:16:08, and its 14 new items have `story_id IS NULL` and NULL facts. `0003` runs `UPDATE items SET story_id = id`, and v2 ingest computes `story_id`, so these rows were inserted after the migration by v1 code. The migrating process is **the unit test suite** (reproduced 2026-10-09, HIGH): `apps/cli/tests/commands/daily.test.ts` runs `kk daily prepare` in-process from the repo root without `KK_CONFIG` or a chdir; `warnUnreleasedRuns` (`apps/cli/src/commands/daily.ts:122-150`, documented "best-effort and read-only") resolves the cwd-relative default `.works/kk.db` and calls `openStore`, which always runs `applyKkMigrations` (`packages/kk-store/src/db.ts:47-53`). Repro: a v1 copy at `<tmp>/.works/kk.db` (journal 0001+0002), `cd <tmp> && bun test apps/cli/tests/commands/daily.test.ts` → 16 pass and the journal gains `0003_store_v2`. The concurrent merge session ran `bun run gate` from this tree at 10:16, so any test or gate run in the live tree migrates the operator store.
- **The failure itself.** The 0.0.33 `LabelsDao` upserts on `[labels.itemId, labels.decisionId]` (0.0.33 `dist/index.js:44145,44162`). `0003` dropped that unique index. The v2 store holds only `labels_observation_unique (item_id, decision_id, maker, run_id)`, so the v1 upsert raises `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`. `main`'s path targets the 4-column identity (`packages/kk-store/src/dao/labels.ts:249-259`) and matches the store.
- **The job and the shell already agree.** Both resolve `~/.bun/bin/kk`. The actual gap is that the global build is older than the store's schema, and nothing detects that. `applyKkMigrations` (`packages/kk-store/src/migrations.ts:296-341`) never checks for journal ids it does not know, so an old binary silently writes a newer store.

**Live-store damage.** Measured on a copy taken at 10:47:

- 92 items. 14 have no `story_id` or facts. 24 have no label rows.
- 340 labels, all legacy (`catalog_version IS NULL`): 325 heuristic, 9 model, 6 default. The 9 model rows can never be current (0239 R4).
- 0 rows for the three judgment decisions, so `kk store extract --topic ai-news` is empty.
- Every tick fails the same way until the global `kk` is v2. The failure is non-destructive: ingest still lands items and the lock is released.

**Correction to 0241's recovery note.** Opening `.works/incident-2026-10-09T0952/kk.db` in place reads its sibling `-wal` and shows the v2 state (`no such table: episode_usage`). The v1 file (68 items / 340 labels) is recoverable only by copying `kk.db` **without** its `-wal`/`-shm`.

### Requirements

- [x] R1. **Schema-skew guard.** Before applying anything, `applyKkMigrations` (`packages/kk-store/src/migrations.ts:296`) must reject a store whose `__kk_store_migrations` holds an id missing from `KK_MIGRATIONS`. The error is `kk.store.schema-newer: <db> has migrations [<ids>] this kk (<version>) does not know — upgrade kk`, and the store is left untouched. This protects every binary from 0.0.34 on; 0.0.33 cannot be patched.
- [x] R2. **Operator gate: the global `kk` becomes v2.** `~/.bun/bin/kk` must resolve to a build that contains 0225–0229, 0239, 0240 and R1, and `kk store --help` must list `select`/`mark-published`/`release`.
  - Recommended: release 0.0.34 through the CI publish (`scripts/publish.ts`), then `bun add -g @gobing-ai/knowledge-kit@0.0.34`.
  - Stop-gap: `bun link` from **this** tree's `apps/cli`. The job's cwd is this same tree, so code, catalog and config stay in lockstep. Never link a worktree build (0241).
  - Either option needs explicit operator authorization. Without it, the task stops as `blocked` after R1.
- [x] R3. **Repair the live data under the collect lock.**
  1. `kk store lock acquire --name collect --run g32-repair`.
  2. `PRAGMA wal_checkpoint(TRUNCATE)`, then `cp .works/kk.db .works/kk.db.pre-0242`.
  3. `kk store backfill-facts`.
  4. `kk store label --run g32-relabel --new-ids <path to a JSON array of every item id>` (default `--mode heuristic`, the same mode the collector uses), which re-observes all 92 items under the v2 catalog and config.
  5. `kk store lock release --name collect --run g32-repair`.
  6. Verify: 0 items with NULL `story_id`, every item has a current china-politics label, and `kk store extract --topic ai-news` returns count > 0.
- [x] R4. **One real `kk-collect` reaches `done`.** Use the next scheduled tick, or run `spur workflow run plugins/kk/workflows/kk-collect.yaml` from this tree. The run's new items carry label rows with its run id, plus `story_id` and facts.
- [x] R5. **Record the settled state** in `docs/03_ARCHITECTURE.md`'s persistent-store paragraph:
  - the live store is on v2, and only the global `kk` writes it;
  - launchd resolves `kk` via the plist PATH (`~/.bun/bin` first), and an interactive shell resolves the same file;
  - **upgrade order:** a schema-bumping change reaches the live tree only together with a global `kk` that carries it, and R1 enforces this from now on;
  - the recovery paths: `.works/kk.db.pre-0242`, or the incident archive's `kk.db` copied without its `-wal`/`-shm` (v1, 68 items / 340 labels).

- [x] R6. **Stop the test suite from migrating the live store** (the 10:16:07 migrator).
  1. `warnUnreleasedRuns` (`apps/cli/src/commands/daily.ts:122-150`) must not migrate: add `migrate?: boolean` (default `true`) to `openStore` (`packages/kk-store/src/db.ts:47-53`) and pass `migrate: false`; a store whose journal is behind then fails the query and the existing try/catch keeps the probe best-effort.
  2. `apps/cli/tests/commands/daily.test.ts` sets `KK_CONFIG` to a temp config whose `store.db_path` is under the test's temp dir (restore in `afterEach`). Audit every in-process test that reaches `resolveStorePath`/`openStore` without `--db` (`rg -n "resolveStorePath|openStore\(" apps/cli/src` → callers; match against tests that call `main(` without `KK_CONFIG`) and isolate each one found.
  3. Regression check: a v1 store at `<tmp>/.works/kk.db`, run `kk daily prepare` with cwd `<tmp>`; the journal is unchanged.

### Acceptance Criteria

- [x] AC1 — On a store whose journal lists an id unknown to the binary, opening it fails with `kk.store.schema-newer` naming the ids, and the store bytes and journal are unchanged (req: R1).
- [x] AC2 — `readlink -f ~/.bun/bin/kk` resolves to an operator-authorized v2 build, and `kk store --help` lists `select`, `mark-published` and `release` (req: R2).
- [x] AC3 — After the repair, the live store has 0 NULL `story_id`, a current `kk-item-china-politics` label on every item, and a non-empty `kk store extract --topic ai-news` (req: R3).
- [x] AC4 — A real `kk-collect` run reaches `done`, and its new items carry label rows with that run id (req: R4).
- [x] AC5 — `docs/03_ARCHITECTURE.md` records the live store's schema, its writer, the upgrade-order rule and the recovery paths (req: R5).

- [x] AC6 — With a v1 store in cwd, `kk daily prepare` leaves `__kk_store_migrations` unchanged; and running `bun test apps/cli/tests/commands/daily.test.ts` from a dir holding a v1 `.works/kk.db` leaves that journal unchanged (req: R6).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-09 refine

- **Q: Is the failure a v2 code defect?** No. `main`'s labels upsert matches `labels_observation_unique`; the failing step was 0.0.33. Closed.
- **Q: Do the job and an interactive shell resolve different `kk` builds?** No. Both resolve `~/.bun/bin/kk`, which is 0.0.33. The real mismatch is binary vs. store schema. The old R3 was reframed as R2 (upgrade the global binary) plus R1 (detect the skew).
- **Q: Release or link?** The release is recommended, because the global then matches a published, reproducible artifact. A `bun link` from this tree is an acceptable stop-gap. Both are operator decisions, and the task blocks at R2 without one.
- **Q: Restore v1 instead?** Rejected. The store matches `main`, and a restore loses 24 items.

- **Q: Which process migrated the store at 10:16:07?** (Answered 2026-10-09, HIGH.) The unit suite: `daily.test.ts` → `kk daily prepare` → `warnUnreleasedRuns` → `openStore` on the cwd-relative `.works/kk.db`. Reproduced on a v1 copy. Added R6/AC6; R1's skew guard does not cover this case (the test binary is *newer* than the store, so it migrates legitimately).

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

0. **Before anything else (R6):** until R6 lands, do not run `bun test` / `bun run gate` from the live tree — use a worktree. Implement R6 first: write the AC6 regression test (fails today), add `openStore({ migrate })`, isolate `daily.test.ts` and any audited sibling, rerun AC6.
1. R1: write the guard test (fake future journal id → rejected, store unchanged), then implement the guard in `applyKkMigrations`. Run `bun run gate`.
2. Confirm that 0239 and 0240 are merged. Ask the operator for R2 (release 0.0.34 + `bun add -g`, or the in-tree `bun link`). Verify with `readlink -f ~/.bun/bin/kk` and `kk store --help`.
3. R3: lock → checkpoint + backup → `backfill-facts` → full relabel → release. Record the before/after SQL counts and the extract count in Testing.
4. R4: run one collect, or wait for the next tick, and record its run id and its rows by SQL.
5. R5: write the persistent-store paragraph. Run `bun run gate` and `spur task check 0242`.

### Root Cause

Verified. The 10:00 tick ran 0.0.33 for every step (`~/.bun/bin/kk` → `/Users/robin/node_modules/@gobing-ai/knowledge-kit/dist/index.js`, which has no `0003_store_v2`). A v2 build opened the same cwd-relative store at 10:16:07 (journal `applied_at 1791566167006`) and applied `0003`, which dropped the `(item_id, decision_id)` unique index. The 0.0.33 label upsert still targets that index (0.0.33 `dist/index.js:44145,44162`), and that produces the exact error in `.works/kk-collect/launchd.log:294`.

Contributing gap: `applyKkMigrations` (`packages/kk-store/src/migrations.ts:296`) never detects a journal that is newer than the binary, so the skew surfaced as a SQL error deep in the label step rather than at open. The 10:16:07 opener is the unit suite: `daily.test.ts` → `kk daily prepare` → `warnUnreleasedRuns` (`apps/cli/src/commands/daily.ts:134-136`) → `openStore` on the cwd-relative live store, which migrates (`packages/kk-store/src/db.ts:47-53`). Reproduced on a v1 copy (HIGH). Two defects: tests are not isolated from the live store, and a "read-only" probe migrates.

### Solution

#### Change map

- `packages/kk-store/src/migrations.ts:296-310`: `applyKkMigrations` checks `__kk_store_migrations` on open, throwing `kk.store.schema-newer: <db> has migrations [<ids>] this kk does not know — upgrade kk` before any DDL or journal check if unknown migrations exist (R1, AC1).
- `packages/kk-store/tests/migrations.test.ts:553-571`: unit test verifying rejection on unknown future migration id and confirming store bytes and journal remain untouched (R1, AC1).
- `docs/03_ARCHITECTURE.md:142-147`: updated Persistent store paragraph recording live store v2 status, plist PATH resolution, schema-skew upgrade order rule, and recovery paths (R5, AC5).
- R2, R3, R4: stopped as `blocked` at operator gate awaiting global binary upgrade (`bun link` from main or 0.0.34 release) per task specification and operator authorization.

#### R6 change map — the test suite no longer migrates the live store

- `packages/kk-store/src/db.ts:10-27` — `OpenStoreOptions` gains `migrate?: boolean` (default `true`),
  documented with the incident that motivates it.
- `packages/kk-store/src/db.ts:66` — `options.migrate === false ? 0 : await applyKkMigrations(adapter)`.
  A read-only caller therefore performs no DDL and no journal write. The `migrate: false` path also skips
  the R1 schema-newer guard deliberately: that guard exists to stop a **write** against a newer store, and
  a read cannot damage one.
- `apps/cli/src/commands/daily.ts:132-140` — `warnUnreleasedRuns` opens with `migrate: false`. This is the
  actual defect: the probe is documented "best-effort and read-only", but `openStore` migrated on open,
  so a read upgraded the store.
- `apps/cli/tests/commands/daily.test.ts` — file-level `beforeEach`/`afterEach` pointing `KK_CONFIG` at a
  per-test temp config whose `store.db_path` is inside that test's temp dir; the two tests that build
  their own config now carry a store path too; the corrupt-config test `chdir`s into its temp dir, because
  a corrupt config is the one case isolation cannot redirect (the path is unreadable, so the resolver
  falls back to the cwd-relative default).
- `apps/cli/tests/voice2-dag.test.ts` — the same isolation. Its `daily prepare` call was the second
  in-process migrator; the audit (`rg resolveStorePath|openStore apps/cli/src` cross-matched against tests
  driving `main()` without `--db`) found exactly these two files.
- `packages/kk-store/tests/migrations.test.ts:575` — the load-bearing regression test, placed where the
  real v1 fixture lives (`seedV1Store`), with an explicit control.

#### R2–R4 execution record

Route chosen by the operator: the in-tree `bun link` stop-gap rather than a 0.0.34 release, because it
restores the collector in one command and is reversible with
`bun install -g @gobing-ai/knowledge-kit@0.0.33`. **Consequence to carry forward:** while the global is a
link, production tracks this working tree rather than a published artifact, so a release should be cut
before any further schema-bumping change — the same class of coupling 0241 recorded.

The linked global resolves to `apps/cli/dist/index.js`, the `kk` bin `apps/cli/package.json:31` points at
(`prepack` builds it, declared at `apps/cli/package.json:44` and wired as the `kk` bin at `apps/cli/package.json:31`). The store-schema contract the collector now matches is
`packages/kk-store/src/dao/labels.ts:249` (the 4-column observation upsert) against
`packages/kk-store/src/migrations.ts:161` (`labels_observation_unique`), guarded on open by
`packages/kk-store/src/migrations.ts:312` (R1) and read-only for probes through
`packages/kk-store/src/db.ts:66` (R6). The launchd job that consumes all of this runs `spur workflow run`
with its working directory pinned to this tree, and the repair's pre-migration copy is
`.works/kk.db.pre-0242`.

No product or test source changed for R2–R4: the repair surface (`kk store backfill-facts`,
`apps/cli/src/commands/store.ts:1517`) and the guard (R1) all shipped earlier in this batch, and R6's fix
(`apps/cli/src/commands/daily.ts:140`) is what makes the suite safe to run against this tree.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Guard in `applyKkMigrations` (`packages/kk-store/src/migrations.ts:297`): unknown journal ids collected at `packages/kk-store/src/migrations.ts:305-306`, rejected with `kk.store.schema-newer` at `packages/kk-store/src/migrations.ts:312`. Test `packages/kk-store/tests/migrations.test.ts:558` re-run this pass. |
| R2 | MET | `readlink -f ~/.bun/bin/kk` → `/Users/robin/xprojects/knowledge-kit/apps/cli/dist/index.js` this pass (global package links this tree's `apps/cli`, the authorized stop-gap, never a worktree); `kk store --help` lists `select`, `mark-published`, `release`. Version `0.0.33` matches `apps/cli/package.json:3`. |
| R3 | MET | Read-only on a scratch copy of the live store this pass: 0 items with NULL `story_id`, 0 of 101 items lacking a `kk-item-china-politics` label, `kk store extract --topic ai-news` → `{"count":12}`; `.works/kk.db.pre-0242` present. |
| R4 | MET | Scratch copy this pass: all 6 `collect_runs` `status='done'`; newest `6ccfef89-1880-4031-9e75-984e2fe2b7c6` (inserted 9) owns 143 label rows across 16 items with that `run_id`. |
| R5 | MET | `docs/03_ARCHITECTURE.md:142-147`: live store on v2, only the global `kk` writes it, launchd PATH resolution, upgrade-order rule tied to the R1 guard, recovery paths `.works/kk.db.pre-0242` and the incident archive. |
| R6 | MET | `migrate?: boolean` on `OpenStoreOptions` (`packages/kk-store/src/db.ts:22`), honored at `packages/kk-store/src/db.ts:66`; `warnUnreleasedRuns` opens with `migrate: false` (`apps/cli/src/commands/daily.ts:140`); tests isolate the store via `KK_CONFIG` (`apps/cli/tests/commands/daily.test.ts:47-63`). Tests `packages/kk-store/tests/migrations.test.ts:576` and `apps/cli/tests/commands/daily.test.ts:467` re-run this pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/kk-store/tests/migrations.test.ts:558`; 2-file run 31 pass / 0 fail / 110 expect() this pass. |
| AC2 | MET | command | `readlink -f ~/.bun/bin/kk` and `kk store --help` this pass (see R2); link target `~/.bun/install/global/node_modules/@gobing-ai/knowledge-kit` → this tree's `apps/cli`.; bin target declared at `apps/cli/package.json:3` version line (0.0.33). |
| AC3 | MET | command | sqlite3 + `kk store extract --db <scratch copy> --topic ai-news --out <scratch>` this pass: 0 NULL `story_id`, every item labeled, count 12. |
| AC4 | MET | command | sqlite3 on the scratch copy this pass: run `6ccfef89-1880-4031-9e75-984e2fe2b7c6` `done` with 143 label rows carrying its `run_id`. |
| AC5 | MET | command | `docs/03_ARCHITECTURE.md:142-147`; `grep -n "pre-0242\|Upgrade order" docs/03_ARCHITECTURE.md` this pass. |
| AC6 | MET | test | `apps/cli/tests/commands/daily.test.ts:467` (behind store journal untouched end to end) and `packages/kk-store/tests/migrations.test.ts:576`; re-run this pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

> **Coordinator re-disposition (2026-10-09, `/sp:dev-review` after `/sp:dev-verifyall --feature G32`).** The first table's P1 `BLOCKED (R2)` row is from the superseded interim report and is RESOLVED: R2–R6 completed and were re-verified this run (global `kk` resolves to this tree's build; scratch copy of the live store: 6/6 `collect_runs` done, run `6ccfef89…` owns 143 label rows; tests 31 pass). Final-report finding 1 moves from ACCEPTED to DEFER with its owner (the next release). No P1/P2 finding stands.


| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 | operations | Task stopped as blocked after R1 awaiting operator authorization for global binary upgrade / release | docs/tasks/0242 | RESOLVED — R2 completed with operator authorization (`readlink -f ~/.bun/bin/kk` → this tree's `apps/cli/dist/index.js`, `kk store --help` lists select/mark-published/release; re-checked 2026-10-09) |

#### Review Report — 0242 (2026-10-09)

**Scope:** Schema-skew guard (R1), persistent-store architectural documentation (R5). R2–R4 blocked at operator gate per task design.
**Verdict:** PARTIAL (R1 & R5 MET; R2–R4 blocked at operator gate)
**Confidence:** HIGH — for R1 and R5, each is shipped and independently verified: R1 at `packages/kk-store/src/migrations.ts:312` throws `kk.store.schema-newer` before any DDL, with a negative test at `packages/kk-store/tests/migrations.test.ts:553` that injects `9999_future_migration`, asserts the rejection, and asserts the journal is unchanged; R5 at `docs/03_ARCHITECTURE.md:142-147` was read back from the file. The R2–R4 gap is named, not asserted: the global `kk` upgrade (R2), the locked live-store repair (R3) and a green `kk-collect` (R4) were **not run** — they are operator-gated and the task is `blocked`. So the correct reading of this report is "the guard is proven; the live store is still misconfigured", and no claim here says otherwise.

#### Review Report — 0242 (final, 2026-10-09) — **current disposition**

**Scope:** the whole task after R1–R6 all completed: the schema-skew guard, the read-only open, the test
isolation, the persistent-store docs, and the operator-authorized global upgrade + live repair + green
collect.
**Dimensions:** functional traceability, correctness, security/integrity, operability
**Verdict:** PASS
**Confidence:** HIGH — every requirement is tied to a re-derivable check: R1 `packages/kk-store/src/migrations.ts:312` with a negative test at `packages/kk-store/tests/migrations.test.ts:558`; R2 `readlink -f ~/.bun/bin/kk` -> this tree's `apps/cli/dist/index.js` plus `kk store --help` listing `select`/`mark-published`/`release`; R3 `kk store backfill-facts` -> `{"updated":92}` with the store then showing 0 NULL `story_id`, 0 items without a current `kk-item-china-politics` label, and `kk store extract --topic ai-news` -> `{"count":14}`; R4 run `6ccfef89-1880-4031-9e75-984e2fe2b7c6` `done — outcome=success` with 143 label rows and all 9 new items labelled; R5 `docs/03_ARCHITECTURE.md:142-147`; R6 `packages/kk-store/src/db.ts:66` with the falsified control at `packages/kk-store/tests/migrations.test.ts:575` and the live-store-bytes-unchanged run of `bun run gate`.

##### Findings

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P3 | operability | The global `kk` is now a **link** into this working tree, so production tracks an uncommitted-able tree rather than a published artifact; the next schema-bumping change must ship with a release, not only a merge. | `~/.bun/bin/kk` -> `apps/cli/dist/index.js`; see this task's R2–R4 record | DEFER — owner: the next release (CI publish of 0.0.34 via `scripts/publish.ts`), required before any schema-bumping change per the upgrade-order rule at `docs/03_ARCHITECTURE.md:143-145`; operator chose the stop-gap knowingly; release-before-next-schema-change is recorded here and in the R2–R4 record |
| 2 | P4 | operability | The collector's own `kk ledger append` step logs `kk.ledger.run.running` because it runs before the run finalizes; the ledger row lands on the next `kk ledger sync`. | run `6ccfef89-1880-4031-9e75-984e2fe2b7c6` trace, `release` step | ACCEPTED — pre-existing behaviour, does not block the run, which finalized `done` |
| 3 | P4 | evidence | This task's Background numbers (340 labels, 0 judgment rows, 24 unlabelled items) no longer describe the store: the relabel had already happened before the repair ran, so the planned model spend was not needed and the Design's cost estimate was stale. | This task's `## Testing` R3.4 | RESOLVED — reported, not silently reconciled; the AC3 predicate was measured against the CURRENT store |

##### Residual risk

- **A stale global `kk` can recur.** R1 makes the next skew fail loudly at open instead of half-writing a
  run, but nothing forces the global to be upgraded *with* the schema — that remains a release-process
  discipline (R5 records the rule).
- **The relabel that repaired the judgment decisions was performed outside this task** and is not
  attributed here; only its effect was verified (0 items without a current china-politics label).

### References

- Failure log: `.works/kk-collect/launchd.log` (newest run `54b2c6d7-dfe5-43d7-a87d-62100542093f`).
- Workflow: `plugins/kk/workflows/kk-collect.yaml` (steps at `:58`, `:75`, `:94` invoke bare `kk`).
- Store: `.works/kk.db` (journal `0003_store_v2`); recovery file `.works/incident-2026-10-09T0952/kk.db`.
- Code: `packages/kk-store/src/dao/labels.ts` (the observation upsert), `packages/kk-store/src/dao/items.ts`
  (the ingest upsert), `packages/kk-store/src/migrations.ts:187-205`.
- Related: 0241 (the incident record), 0238 (the daily voice2 DAG's agent nodes), `docs/tasks/0226_*.md`
  (the label pass), `docs/tasks/0208_*.md` / G31 (the collector).

### History

- 2026-10-09T18:42:10.091Z todo → wip (system)
- 2026-10-09T18:50:40.582Z wip → blocked (system)
- 2026-10-09T21:20:18.696Z blocked → wip (system)
- 2026-10-09T21:20:53.538Z wip → testing (system)
- 2026-10-09T21:20:57.308Z testing → done (system)

