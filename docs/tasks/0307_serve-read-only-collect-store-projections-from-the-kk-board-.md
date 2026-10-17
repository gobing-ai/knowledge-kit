---
schema_version: 1
name: Serve read-only Collect store projections from the KK board reader
status: todo
template: feature-impl
created_at: 2026-10-17T05:04:06.955Z
updated_at: "2026-10-17T05:19:41.384Z"
feature_id: G81
priority: P2
tags:
  - board
  - reader
  - kk-store
estimate_hours: 7

---

## 0307. Serve read-only Collect store projections from the KK board reader

### Background

Implements: R1 — The reader opens the kk store read-only; R2 — An unavailable store degrades only the store panels; R3–R7 server-side projections; R8 — Store routes keep the reader's security envelope; R10 — Decision and surface docs are updated with the change.

Operator ask (run 5f03d609-ece9-4f6f-9555-dba2a7b0cb2b): show the result and progress of kk-collect from the kk.db tables collect_runs, items, labels and selections. ADR-035 amendment 2026-10-16 lifts artifacts-only for Collect only. Design: docs/design/collect-store-views.md §1, §3, §4.

**Refine corrections (2026-10-16)**
- "projections query the store via `adapter.queryAll`" → `Store` exposes only DAOs and `BaseDao.adapter` is `protected` (ts-db 0.5.23 `base-dao.d.ts:24`; `packages/kk-store/src/db.ts:67-76`) → add a read-only `CollectViewDao` in kk-store, exposed as `Store.collectView`; all aggregate SQL lives there.
- "missing file → `board.store.missing`" → `openStore` passes the path to `createDbAdapter` (`db.ts:60`), which would create an empty DB file → `lstat` the path first and never call `openStore` when it is absent.
- "journal newer than `KK_MIGRATIONS` → `board.store.newer`" → with `migrate:false` no guard runs (`db.ts:66`); `KK_MIGRATIONS` is not exported from the package index → extract the unknown-id comparison of `applyKkMigrations` (`migrations.ts:302-305`) into an exported `unknownKkMigrationIds(adapter)` used by both the guard and `CollectViewDao`.
- "per-run routes use shipped `identify()` (Spur-verified)" → `identify()` (`reader.ts:616-639`) is shape-only; Spur verification lives in `authorize()` (`reader.ts:210-290`), which also requires a capture record (404 `board.capture.missing`) — historic store runs predate capture → extract the project + run-detail checks into a capture-free `authorizeRun(workflow, runId)` that `authorize()` also calls.
- "every other route keeps refusing query parameters" → `parseQuery` runs before route matching (`reader.ts:572`) → move it after matching so only the store routes parse their declared parameters.
- Label policy source confirmed: `readStoreConfig` (`packages/kk-store/src/config.ts:252`) on `resolveKkConfigPath()` = `KK_CONFIG` or `~/.config/kk/config.yaml` (`apps/cli/src/invoke.ts:52`). A config read failure leaves `effective` empty with diagnostic `board.store.policy`; run rows are still served.
- Concurrency: worktree `sp/runall-a23-083b` edits `docs/04_DESIGN.md` §1.12 (bot); this task edits the `kk board` section only — textual rebase risk, no shared code.

### Requirements

- [ ] R1 — `apps/cli/src/board/collect-store.ts` serves the Collect store routes from `<projectPath>/.works/kk.db`: it `lstat`s the file first (absent → no open, `board.store.missing`), then opens with `openStore({path, migrate:false})`, closes in `finally`, and issues no write, DDL or migration; the file's `sqlite_master` and row counts are unchanged after any request.
- [ ] R2 — Open/busy failure → `board.store.unreadable`; `unknownKkMigrationIds` non-empty → `board.store.newer`; each is HTTP 200 with `availability: 'unavailable'`, empty `rows` / `row: null` / `items: []`, bounded message, no raw SQLite text or out-of-project path. A label-policy read failure only empties `effective` with `board.store.policy`.
- [ ] R3 — `packages/kk-store/src/dao/collect-view.ts` `CollectViewDao` (read-only, exported, `Store.collectView`) provides `runRows(runIds)`, `lastStoredAt()`, `labelQuality(runId)`, `itemsPage(runId, filter, page)`, `itemSources()`; `packages/kk-store/src/migrations.ts` exports `unknownKkMigrationIds(adapter)` and `applyKkMigrations` uses it (no behaviour change).
- [ ] R4 — `GET /api/workflows/kk-collect/store/overview?runs=<id>,…` (1–25 ids, each matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`) returns `CollectStoreOverview`: `lastStoredAt` and `rows[runId]` = `CollectRunStoreRow` or `null` when no `collect_runs` row exists. No Spur call.
- [ ] R5 — `CollectRunStoreRow` carries `sourceCounts` (parsed `source_counts_json`, invalid JSON → `{}` + diagnostic), `inserted`, `updated`, `labelRows`, `labeledItems` (distinct items), `labelRowsBySource`, and `yield` over items with `first_seen_run = run` using each item's strongest status published > selected > dropped.
- [ ] R6 — `GET /api/workflows/kk-collect/runs/<id>/store` (capture-free `authorizeRun`) returns `CollectRunStore`: the row plus per-decision `labelQuality` — run rows by value × HIGH/MEDIUM/LOW/none, and `effective` via `LabelsDao.currentFor(ids, policy)`.
- [ ] R7 — `GET /api/workflows/kk-collect/runs/<id>/store/items` (capture-free `authorizeRun`) returns `CollectStoreItems`, 25 per page, items with `first_seen_run` or `last_seen_run` = run; filters `page` (≥1), `source` (∈ `itemSources()`), `seen` (new|reseen), `decision` (∈ `ITEM_DECISION_IDS`) + `value` (`[A-Za-z0-9._-]{1,64}`, both or neither), `selection` (selected|published|dropped|none); anything else → 400 `board.query.invalid`; no body field; title ≤300 chars; `url` only when http(s).
- [ ] R8 — Shipped loopback/host/origin/method refusals apply unchanged; `authorizeRun` keeps the shipped project-mismatch (403), authority-unavailable (503) and run/workflow mismatch codes; `authorize()` delegates to it so shipped routes behave identically; only the three store routes accept query parameters.
- [ ] R9 — Response types in `apps/board/src/contracts.ts` (type-only export); `docs/04_DESIGN.md` `kk board` section documents routes, queries, shapes and availability codes in the same commit.

**Out of scope:** UI (0308); installed-Board check (0309); any store write, schema change or `kk-collect.yaml` change; store views for the other two modules.

### Acceptance Criteria

- [ ] AC1 — The reader opens the kk store read-only
- [ ] AC2 — An unavailable store degrades only the store panels
- [ ] AC3 — Store routes keep the reader's security envelope
- [ ] AC4 — Decision and surface docs are updated with the change

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-17T05:18:28.507Z

- Q: Widen `Store` with a raw query method or add a DAO? → A: read-only `CollectViewDao` in kk-store; keeps SQL beside the schema and the adapter private. Closed 2026-10-16 (refine).
- Q: Authorize per-run store routes with capture-gated `authorize()`? → A: no; capture-free `authorizeRun` (project + Spur run workflow), because store rows exist for runs that predate capture. Closed 2026-10-16 (refine).
- Q: Cache an open store handle? → A: deferred; per-request open until reader latency is measured (ponytail ceiling noted in Design).

### Design

- WHAT/WHY: give the reader read-only access to the four Collect tables (ADR-035 amendment 2026-10-16) without widening `Store` to a raw adapter. WHERE: `packages/kk-store/src/dao/collect-view.ts` (SQL), `packages/kk-store/src/migrations.ts` (`unknownKkMigrationIds`), `packages/kk-store/src/db.ts` + `index.ts` (wire/export), `apps/cli/src/board/collect-store.ts` (open, availability, mapping to contracts), `apps/cli/src/board/reader.ts` (routes, `authorizeRun`, per-route query), `apps/board/src/contracts.ts`, `docs/04_DESIGN.md`.
- Frozen names: `CollectViewDao`, `Store.collectView`, `unknownKkMigrationIds`, `authorizeRun`, `CollectStoreOverview`, `CollectRunStoreRow`, `CollectRunStore`, `CollectStoreItem`, `CollectStoreItems`, codes `board.store.missing|unreadable|newer|policy`, `board.query.invalid`; route paths and shapes per `docs/design/collect-store-views.md` §3.
- Algorithm: `runRows` = one GROUP BY per table keyed by `run_id IN (…)`; yield = items `first_seen_run IN (…)` LEFT JOIN selections, per item `MAX(CASE status WHEN 'published' THEN 3 WHEN 'selected' THEN 2 WHEN 'dropped' THEN 1 END)`, then counted per run. `itemsPage` filters in SQL with bound params; decision/value filter matches the item's `labels_current` value (reuse `labelsCurrentSql`, `labels.ts:73-100`) under the same policy.
- Rejected: exposing `adapter` on `Store` (any reader could write); copying store facts into artifacts (duplicates state, needs workflow change); a long-lived handle (ponytail: per-request open; cache one when latency is measured); reusing capture-gated `authorize()` (would 404 every run that predates capture).
- Anti-patterns: never call `openStore` on a missing path; never report `0` for unavailable data; never expose `collect_runs.started_at/finished_at` as a duration; never return `body`.
- Dependents: 0308 consumes the three routes and the contract types unchanged; 0309 seeds its throwaway store through the real kk-store DAOs and reads it back through these routes.

### Plan

1. Failure list first as tests: `packages/kk-store/tests/dao/collect-view.test.ts` (temp store via real DAOs: no-row run, yield precedence, rows vs items, filters, `unknownKkMigrationIds`) and `apps/cli/tests/board/collect-store.test.ts` (missing file not created, newer journal, unreadable, policy failure, `sqlite_master` digest unchanged). (R1–R3, R5)
2. Implement `unknownKkMigrationIds` + refactor `applyKkMigrations` onto it; implement `CollectViewDao`, wire `Store.collectView`, export. (R3)
3. Implement `collect-store.ts` projections and availability mapping. (R1, R2, R5)
4. In `reader.ts`: extract `authorizeRun`, make `authorize()` delegate, add the three routes, move `parseQuery` after matching with per-route parsers; extend `apps/cli/tests/board/reader.test.ts` for envelope refusals and query scoping. (R4, R6–R8)
5. Contract types; `docs/04_DESIGN.md` `kk board`. (R9)
6. `bun run lint`, `bun run test` (per-file ≥90%), `bun run build`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
