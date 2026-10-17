---
schema_version: 1
name: Residuals from 0309
status: backlog
template: standard
created_at: 2026-10-17T17:20:34.199Z
updated_at: "2026-10-17T17:20:34.301Z"

---

## 0311. Residuals from 0309

### Background

Source task: 0309 (feature G81) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:e71b9a1f — apps/cli/src/board/collect-store.ts:99, packages/kk-store/src/db.ts:61 (:65 the PRAGMA), apps/board/scripts/verify-collect-live.ts:639: The reader's "read-only" store open is a **read-write** SQLite connection: `openStore({migrate:false})` (`apps/cli/src/board/collect-store.ts:99`) opens the file read-write and issues `PRAGMA journal_mode = WAL` (`packages/kk-store/src/db.ts:65`); closing it as the last connection **checkpoints the WAL into the main file**. Reproduced on a copy of the live store: db 4,231,168 → 4,247,552 bytes, `-wal` 696,312 → 0 bytes — through the harness's symlink layout as well. So AC1's "without touching the store" is true for rows/DDL, not for file bytes, and if a checkpoint fires during a run the guard reports it as "a collect tick may have landed" (`:639-644`) — a misleading FAIL. Latent today: 3 of 3 live runs left db and `-wal` byte-identical (SQLite only checkpoints when the reader is the last connection; run 2 left both untouched)

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
