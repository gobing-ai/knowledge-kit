---
schema_version: 1
name: "0230 residual: the live store was migrated to v2 by the scheduled collector (0003 at 04:00:06) while R1's evidence claims it untouched - restate the evidence and settle the live tree"
status: todo
template: issue
created_at: 2026-10-09T15:41:10.874Z
updated_at: "2026-10-09T16:53:54.267Z"
feature_id: G32

---

## 0237. 0230 residual: the live store was migrated to v2 by the scheduled collector (0003 at 04:00:06) while R1's evidence claims it untouched - restate the evidence and settle the live tree

### Background

Captured from the creation title: "0230 residual: the live store was migrated to v2 by the scheduled collector (0003 at 04:00:06) while R1's evidence claims it untouched - restate the evidence and settle the live tree".

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Include repro/expected behavior if it helps traceability. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Use a regression scenario proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

Resolution (batch driver, 2026-10-09): the operator authorized restoring the live store, and it was done.

The mechanism, for the record: every store reader opens the database through `openStore`
(`packages/kk-store/src/db.ts:47`), which calls `applyKkMigrations` before any query; the scheduled
collector's `kk store lock acquire` (`apps/cli/src/commands/store.ts:210`) therefore applied
`0003_store_v2` (`packages/kk-store/src/migrations.ts:195`, `atomic: true`) to the live store simply by
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

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
