---
schema_version: 1
name: "0230 residual: the live store was migrated to v2 by the scheduled collector (0003 at 04:00:06) while R1's evidence claims it untouched - restate the evidence and settle the live tree"
status: done
template: issue
created_at: 2026-10-09T17:29:59.582Z
updated_at: "2026-10-10T00:29:34.197Z"
feature_id: G32

priority: P1
ac_altitude: task-local
ac_numbering: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0241-verdict.json
---

## 0241. 0230 residual: the live store was migrated to v2 by the scheduled collector (0003 at 04:00:06) while R1's evidence claims it untouched - restate the evidence and settle the live tree

### Background

During the G32 batch (task 0230) the operator's live store was migrated to `0003_store_v2` by the scheduled
collector, while `0230`'s R1 evidence claimed the store was never opened for writing. The claim rested on a
file hash that cannot see a WAL-resident migration.

**Mechanism (verified):** every reader opens through `openStore` (`packages/kk-store/src/db.ts:47`), which
calls `applyKkMigrations` before any query (`:53`); the store path is cwd-relative
(`packages/kk-store/src/config.ts:7`); and the collector's first step `kk store lock acquire` opens the store
(`apps/cli/src/commands/store.ts:210`). The launchd job's working directory is the invoking tree, so simply
opening the store applied the migration. The batch build was `bun link`ed as the global `kk` at the time,
which is what put v2 code behind that open.

**Resolved by this task:** the falsified claim is struck from `0230`'s `## Testing` (it now carries an inline
Correction naming what happened, the same mechanism, and the restore), the article state was archived before
the restore (`.works/incident-2026-10-09T0952/`: `kk.db`, `kk.db-wal`, `kk.db-shm`), the live `-wal`/`-shm`
were removed and `.works/kk.db` replaced from the checkpointed pre-cut-over backup (verified read-only as v1:
journal `0001`+`0002`, five v1 tables, `episode_usage` present, no `selections`, 78 items / 390 labels,
`integrity_check` ok), and the global link was reverted (`bun unlink` removes the package, so the restore
needed `bun install -g @gobing-ai/knowledge-kit@0.0.33`; verified `kk --version` → `0.0.33` with the
0225–0229 verbs absent, and the store readable again: `kk store extract --topic ai-news` → `{"count":14}`).

**Superseded afterwards (recorded here, filed separately as task 0242).** The live store is now a v2 store
again — journal `0001`+`0002`+`0003`, the 16-column `labels` with `labels_observation_unique`, the v2 `items`
fact columns, 92 items / 340 labels — which is *consistent* with `main` now that the batch has been merged
(the original skew is gone). But the 10:16 scheduled collect failed at `kk store label` with
`ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`, so the collector is broken and the
live-tree question is not settled. The pre-cut-over v1 backup (78 items / 390 labels) existed only in the
batch worktree and was removed with it; a v1 file is still recoverable from the incident archive's `kk.db`
alone (68 items / 340 labels), without its WAL.

The durable guard against a repeat is harness-owned (see the Design section) and is not implemented here.

### Requirements

- [x] R1. Strike the falsified live-store claim from `0230`'s evidence and state what actually happened, with
  the mechanism and the restore — done: `0230`'s `## Testing` carries the inline Correction, and its `## Review`
  finding 1 keeps the falsification record.
- [x] R2. Record the mechanism, the archive path and the resolution in one place so the incident is auditable
  without reading the batch's chat history — done: the Background and Solution sections of this task plus the
  incident archive at `.works/incident-2026-10-09T0952/`, and the learnings entry in `.spur/memory/learnings.md`.
- [x] R3. Record the durable guard with its owner so a repeat is prevented by a check rather than by memory —
  done as a *recorded, harness-owned* proposal: see the Design section. No repo change is justified for it.

### Acceptance Criteria

```gherkin
Scenario: AC1 — 0230's record no longer asserts the live store was untouched (req: R1)
  Given 0230's `## Testing` as written during the batch claims the store was never opened for writing
  When the correction is applied through the CLI and read back
  Then the section names the migration, the mechanism and the restore, and every remaining occurrence of the old wording is a quotation of it

Scenario: AC2 — the incident's mechanism, archive and resolution are recorded in one place (req: R2)
  Given the incident happened and was resolved
  When an auditor reads only this task's Background and Design
  Then the mechanism, the archive path, the restore and the recovery options are all named there

Scenario: AC3 — the repeat-guard is recorded with an owner and no unowned gap (req: R3)
  Given the hazard can recur while no automated check exists
  When this task is closed
  Then the guard's owner surface, its disposition and the project-side fallback are recorded, and no open item is left unattributed
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-09T17:30:00.402Z

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Why no repo change.** The hazard is not this project's code: it is the combination of (a) a global binary
swapped by `bun link`, (b) a scheduled consumer whose cwd is the live tree, and (c) migrations that run on
open. (c) is ADR-030's deliberate design and (b) is the operator's deployment shape; only (a) is a choice the
harness can guard.

**The guard, with its owner.** Proposed to the `sp` plugin's batch worktree lifecycle (owner: the harness —
`execution-batch.md` § WT-1 dirty-tree precheck, the same seam that refuses a dirty tree): when `--worktree`
is combined with a global-binary swap, refuse (or warn once, naming the jobs) if a scheduled consumer's cwd is
the invoking tree. The project-side equivalent, if the harness change is not taken, is an `AGENTS.md`
navigation line: "never link a batch build globally while a scheduled consumer shares the live store; read a
store's schema through SQLite, not a file hash". Both are recorded here rather than implemented, because the
first is outside this repo and the second is always-loaded steering that the operator decides on.

**Recovery options if a v1 store is ever needed again.** (1) `.works/incident-2026-10-09T0952/kk.db` alone
(WAL ignored) is the pre-v2 file: 68 items / 340 labels, journal `0001`+`0002` — restorable by removing the
live `-wal`/`-shm` and copying the archive file over `kk.db`. (2) The 78-item / 390-label checkpointed backup
is **not** recoverable: it lived in the batch worktree and was removed with it. Record option (1)'s path in
any future incident runbook.

### Plan

1. Archive the incident state (done). 2. Restore and verify read-only (done). 3. Revert the global link and
reinstall the released binary (done). 4. Strike the falsified claim in `0230`'s Testing (done). 5. Record the
mechanism, guard and recovery options here (done). 6. Hand the live-store/collector state to 0242 (done).

### Root Cause

Verified: `openStore` applies migrations on open (`packages/kk-store/src/db.ts:47,53`); the store path is
cwd-relative (`packages/kk-store/src/config.ts:7`); the collector's lock step opens the store
(`apps/cli/src/commands/store.ts:210`); the launchd job's cwd is the invoking tree; and the batch build was
`bun link`ed as the global `kk`. Any one of those five being different would have prevented it — the
migration-on-open is the one that made an ordinary open destructive. The evidence claim (`sha256` of
`kk.db`) was true and irrelevant at the same time: the file hash was unchanged while `0003_store_v2` sat in
`kk.db-wal`, so the check must read the journal through SQLite.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

Resolution (batch driver, 2026-10-09): the operator authorized restoring the live store, and it was done.

The mechanism, for the record: every store reader opens the database through `openStore`
(`packages/kk-store/src/db.ts:66`, the `applyKkMigrations(adapter)` call inside `openStore`), which calls `applyKkMigrations` before any query; the scheduled
collector's `kk store lock acquire` (`apps/cli/src/commands/store.ts:210`) therefore applied
`0003_store_v2` (`packages/kk-store/src/migrations.ts:197-207` — the `KK_MIGRATIONS` table, `0003_store_v2` at `:206` marked `atomic: true`) to the live store simply by
opening it, because the store path resolves cwd-relative (`packages/kk-store/src/config.ts:6`) and the
launchd job's working directory is the live tree.

- The incident state was archived first (`.works/incident-2026-10-09T0952/`: `kk.db`, `kk.db-wal`,
  `kk.db-shm`) so the v2 state and the 04:00 collect's writes remain recoverable.
- The live `-wal`/`-shm` were removed and `.works/kk.db` was replaced with the fully checkpointed
  pre-cut-over store (`.works/kk.db.pre-g32` from the batch worktree).
- Verified read-only: journal `0001_kk_store_init` + `0002_labels_confidence_run_id`, the five v1 tables
  including `episode_usage`, no `selections`, 78 items / 390 labels / 12 episode_usage / 4 collect_runs,
  `pragma integrity_check` → ok.
- The 0.0.33 global binary reads it again (`kk store extract --topic ai-news` → `{"count":14}`), so the
  scheduled collector is consistent with the deployed code once more.
- The global link was reverted; `bun unlink` REMOVES the global package, so the restore needed
  `bun install -g @gobing-ai/knowledge-kit@0.0.33` (verified: `kk --version` → 0.0.33, the 0225–0229
  verbs gone). The maker overrides for the three judgment decisions live at `.spur/config.yaml:163-172`.

Still open for this task (unchanged): (a) never link a batch build globally while a scheduled job runs
against the live tree; (b) a `.db` sha256 does not see a WAL-resident migration — assert the journal
through SQLite instead; (c) the Design's rollback step is safe again now that the store is v1, and the
landing decision (merge `sp/runall-g32-5368` or not) remains the operator's.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/tasks/0230_store-v2-cut-over-live-store-migration-dogfood-two-run-disjo.md:336` carries the 0241 Correction in 0230's `## Testing` (restored this verifyall run after the 0230 `--force` re-record had dropped it); 0230's historical Review finding 1 keeps the falsification record (`docs/tasks/0230_store-v2-cut-over-live-store-migration-dogfood-two-run-disjo.md:412`). |
| R2 | MET | Mechanism + archive + restore in this task: Design `docs/tasks/0241_0230-residual-the-live-store-was-migrated-to-v2-by-the-sched.md:105` (recovery), Solution `docs/tasks/0241_0230-residual-the-live-store-was-migrated-to-v2-by-the-sched.md:133` (mechanism) and `:140` (archive). `ls .works/incident-2026-10-09T0952/` this pass: `kk.db` 299008 B, `kk.db-wal` 2710992 B, `kk.db-shm`. Learnings entry `.spur/memory/learnings.md:1601`. |
| R3 | MET | Guard with owner (sp harness, `execution-batch.md` § WT-1) and project-side fallback at `docs/tasks/0241_0230-residual-the-live-store-was-migrated-to-v2-by-the-sched.md:97`; Review row 1 dispositioned ACCEPTED (harness-owned). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — 0230's record no longer asserts the live store was untouched (req: R1) | MET | command | `grep -n -i "never opened for writ\|sidecars untouched"` over the 0230 task this pass: only the Correction cell `docs/tasks/0230_store-v2-cut-over-live-store-migration-dogfood-two-run-disjo.md:336` and the historical Review finding `:412` (both quote/describe the struck claim). |
| AC2 — the incident's mechanism, archive and resolution are recorded in one place (req: R2) | MET | command | `docs/tasks/0241_0230-residual-the-live-store-was-migrated-to-v2-by-the-sched.md:33-37` (Background: archive, restore), `:105` (recovery options), `:133` (mechanism); archive directory listed this pass. |
| AC3 — the repeat-guard is recorded with an owner and no unowned gap (req: R3) | MET | command | `grep -c "owner: the harness"` on the 0241 task → 1 and `spur task show 0242 --json` status `done` this pass; `docs/tasks/0241_0230-residual-the-live-store-was-migrated-to-v2-by-the-sched.md:97` (owner surface + fallback); live-store follow-up handed to 0242 (done). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

> **Coordinator re-disposition (2026-10-09, `/sp:dev-review` after `/sp:dev-verifyall --feature G32`).** Finding 1 moves from ACCEPTED to DEFER with its owner named: no code in this repo can close a harness lifecycle guard. R1–R3 re-verified this run (Correction present at the 0230 Testing R1 row; archive `.works/incident-2026-10-09T0952/` listed; Solution anchors re-pointed to `packages/kk-store/src/db.ts:66` and `packages/kk-store/src/migrations.ts:197-207`). No P1/P2 finding stands.


| # | Priority | Dimension | Finding | Location | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | P3 | process | The guard against a repeat is a recorded proposal, not a check: a linked batch build plus a scheduled consumer of the live store is still one `bun link` away from migrating it again on open. | Harness seam for the proposed guard: `.agents/skills/sp-spur-dev/references/execution-batch.md` § WT-1 (owner: the `sp` plugin, outside this repo) — see this task's Design section. | DEFER (harness-owned: the `sp` plugin batch worktree lifecycle § WT-1, outside this repo; project-side fallback recorded in this task's Design; the schema-skew guard from 0242 R1 now fails a reverse skew loudly) |
| 2 | P3 | evidence | The falsified claim was "verified" by a `.db` file hash, which is blind to a WAL-resident migration — the same technique appears in other runbooks. | `docs/tasks/0230_…md` `## Testing` Correction (this task); `.spur/memory/learnings.md` lessons 1–2. | RESOLVED (this task: the claim is struck and the technique recorded as the thing not to do) |
| 3 | P4 | recovery | The checkpointed pre-cut-over backup (78 items / 390 labels) lived only in the batch worktree and was destroyed with it; the only v1 file left is the incident archive's `kk.db` alone (68 items / 340 labels). | `.works/incident-2026-10-09T0952/kk.db` (this task's Design records the recovery procedure). | ACCEPTED (recorded; the loss is disclosed rather than silently absorbed) |
| 4 | P4 | evidence | The cause of the *second* migration is inferred, not evidenced: the 92-item / 340-label counts match the incident archive's file state plus one ingest, which is consistent with another session restoring that file, but no log proves it. | This task's `## Testing` ("Not verified"); `docs/tasks/0242_…md` R1. | DEFER (0242 — reproduce the state before asserting a lineage) |

No P1/P2 finding stands against this task's own requirements: the record correction (R1), the incident record
(R2) and the guard's owner-recorded disposition (R3) are complete, and the live-tree question is carried by
0242 rather than left implicit.

### References

- `docs/tasks/0230_store-v2-cut-over-live-store-migration-dogfood-two-run-disjo.md` — `## Testing` Correction, `## Review` finding 1.
- `.works/incident-2026-10-09T0952/` — the pre-restore archive (db + wal + shm).
- `.works/kk-collect/launchd.log` — the failing tick.
- `.spur/memory/learnings.md` — the ten batch lessons, including this mechanism (numbered 1 and 2).
- Harness seam for the proposed guard: `.agents/skills/sp-spur-dev/references/execution-batch.md` § WT-1.
- `docs/tasks/0242_*.md` — the live-store / collector state this task hands over.

### History

- 2026-10-09T17:42:46.385Z todo → done (system)

