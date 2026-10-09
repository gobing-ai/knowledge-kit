---
schema_version: 1
name: "Live store is v2 again and the scheduled kk-collect fails at kk store label (ON CONFLICT mismatch): settle the store and green the collector"
status: todo
template: issue
created_at: 2026-10-09T17:41:35.203Z
updated_at: "2026-10-09T17:41:37.059Z"
feature_id: G32

priority: P1
ac_altitude: task-local
---

## 0242. Live store is v2 again and the scheduled kk-collect fails at kk store label (ON CONFLICT mismatch): settle the store and green the collector

### Background

Found while recording the 0241 incident (2026-10-09 10:40, all reads read-only). The operator's live store
`.works/kk.db` is a **v2 store again** and the scheduled collector is **failing**.

**Current store state** (`packages/kk-store/src/migrations.ts:187-205` defines the journal):

- journal `0001_kk_store_init`, `0002_labels_confidence_run_id`, **`0003_store_v2`**
- `labels` has the 16 v2 columns and `CREATE UNIQUE INDEX "labels_observation_unique" ON "labels"
  ("item_id", "decision_id", "maker", "run_id")`
- `items` has the five v2 fact columns (`engagement`, `body_chars`, `source_tier`, `lang`, `domain`,
  `story_id`); `selections` exists
- 92 items / 340 labels; `collect_runs` = 5 (it was 4 at the pre-incident backup)

This is **consistent with `main`** now that the batch is merged (the v1-code/v2-store skew that motivated the
restore is gone), so the store itself may need no further action — the question is whether its lineage is the
one the operator wants, since the pre-cut-over v1 checkpoint (78 items / 390 labels) is no longer recoverable
(it lived in the deleted batch worktree). The only v1 path left is `.works/incident-2026-10-09T0952/kk.db`
alone (WAL ignored): 68 items / 340 labels, journal `0001`+`0002`.

**The failure** (`.works/kk-collect/launchd.log`, newest run `54b2c6d7-dfe5-43d7-a87d-62100542093f`, ingest
took items 68 → 92):

```
… label/shell · elapsed=30s · budget=unbounded
  stderr> kk.store.label.failed: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint
✗ label/shell (43s) · Command "kk store label --run "${__WF_0}" --new-ids "${__WF_1}/new-ids.json" > …" exited with 1
↪ label → release-failed → failed
workflow failed: kk-collect -> failed — failed-check
```

The lock was released correctly, so the store is not wedged; the run simply never labelled its new items, and
the ai-news pool therefore gains nothing.

**A second, independent inconsistency to resolve while here:** `kk` on `PATH` is the **old released build**
(`readlink -f $(which kk)` → `/Users/robin/node_modules/@gobing-ai/knowledge-kit/dist/index.js`,
`kk --version` → `0.0.33`, none of `select`/`mark-published`/`release` present), while the repo's own build
`apps/cli/dist/index.js` (built 2026-10-09 10:17, `grep -c 0003_store_v2` → 1) is v2. The workflow's steps
invoke bare `kk` (`plugins/kk/workflows/kk-collect.yaml:58,75,94`), so which build a scheduled run uses
depends on the job's `PATH`/cwd — and the two disagree today. A mixed old/new binary sequence across one run
is a plausible contributor to the failure above, and is worth ruling in or out first.

### Requirements

- [ ] R1. Reproduce the `kk store label` failure against the live store (or a byte copy of it) and name the
  mismatching pair with `file:line`: the `ON CONFLICT` target the label path emits versus the unique indexes
  the store actually holds. Establish whether the failing store was the live v2 store or a different file the
  step's cwd resolved to, and whether an old build ran any step of that run.
- [ ] R2. Fix the cause so the collector completes: a real `kk-collect` run must reach `done` with its new
  items labelled (the label step's output present and its rows visible in the store).
- [ ] R3. Make the scheduled job's build resolution explicit and consistent — name which `kk` the job must use
  (the released global build, or a repo-local build), record it where the job is defined, and ensure an
  interactive shell and the job agree.
- [ ] R4. Record the live store's settled state and its lineage in `docs/03_ARCHITECTURE.md`'s persistent-store
  paragraph: which schema it is on, which binary writes it, and the recovery path
  (`.works/incident-2026-10-09T0952/kk.db` alone = the pre-v2 file, 68 items / 340 labels).

### Acceptance Criteria

- [ ] AC1 — The diagnosis names the `ON CONFLICT` target and the store's index set with `file:line`, and states which build each step of the failing run used (req: R1).
- [ ] AC2 — A real `kk-collect` run reaches `done` and its new items carry labels written by that run (req: R2).
- [ ] AC3 — The job's required `kk` build is recorded at the job definition, and an interactive shell resolves the same build (req: R3).
- [ ] AC4 — The settled store state and its recovery path are recorded in `docs/03_ARCHITECTURE.md` (req: R4).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Rule out the cheap hypothesis first (R1/R3).** The store's v2 indexes are exactly what the v2 label path
targets (`labels_observation_unique` on `(item_id, decision_id, maker, run_id)`, read from the live file), so a
simple target/index mismatch is unlikely on *this* store — which points at the *mixed-binary* hypothesis:
`kk` on `PATH` is 0.0.33 while the repo build is v2, and the collector's steps call bare `kk`. The cheapest
decisive probe is to replay the failing label command twice against a **copy** of the live store: once with
`PATH` resolving to the old build and once with the repo build, and diff the failure. If only the old build
fails, the fix is R3's build pinning, not a store change.

**If the mismatch is real (R2).** Then the v2 label path's upsert is targeting an identity the migrated store
does not carry — check `ItemsDao`'s upsert target as well as `LabelsDao.recordObservation`'s: the ingest step
succeeded (items 68 → 92) while the label step failed, which narrows it to the label write path.

**Do not "fix" this by rebuilding the store.** The store is consistent with `main`'s code; a rebuild would
destroy the 24 items the last collect ingested and the label history. Prefer a code/config fix, and only
restore from the incident archive if the operator decides the lineage itself is wrong — that path loses the
last two collects.

**Order.** R1 (reproduce) → R3 (pin the build, retry) → R2 (only if a real code defect remains) → R4 (record).

### Plan

1. Copy the live store to `/tmp` and replay the failing label command against the copy with each build on
   `PATH`; record both outcomes.
2. Pin the job's build (R3) and re-run one real collect.
3. If a code defect remains, fix the upsert target and add the regression test that fails today.
4. Record the settled state and recovery path in `docs/03_ARCHITECTURE.md`; run `bun run gate`.

### Root Cause

Not established. Evidence so far, without a cause: the live store is a valid v2 store
(`labels_observation_unique` on the 4-column identity; `items` with the v2 fact columns), the ingest step of
the failing run wrote 24 items, and the label step failed with
`kk.store.label.failed: ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`
(`.works/kk-collect/launchd.log`). The build the run's steps used is unverified — `kk` on `PATH` is 0.0.33
(`/Users/robin/node_modules/@gobing-ai/knowledge-kit/dist/index.js`) while `apps/cli/dist/index.js` (built
10:17) is v2. Reproduce before asserting either root cause.

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
