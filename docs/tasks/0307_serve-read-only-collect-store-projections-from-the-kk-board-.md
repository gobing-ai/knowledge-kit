---
schema_version: 1
name: Serve read-only Collect store projections from the KK board reader
status: done
template: feature-impl
created_at: 2026-10-17T05:04:06.955Z
updated_at: "2026-10-18T21:02:23.528Z"
feature_id: G81
priority: P2
tags:
  - board
  - reader
  - kk-store
estimate_hours: 7

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0307-verdict.json
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

- [x] R1 — `apps/cli/src/board/collect-store.ts` serves the Collect store routes from `<projectPath>/.works/kk.db`: it `lstat`s the file first (absent → no open, `board.store.missing`), then opens with `openStore({path, migrate:false})`, closes in `finally`, and issues no write, DDL or migration; the file's `sqlite_master` and row counts are unchanged after any request.
- [x] R2 — Open/busy failure → `board.store.unreadable`; `unknownKkMigrationIds` non-empty → `board.store.newer`; each is HTTP 200 with `availability: 'unavailable'`, empty `rows` / `row: null` / `items: []`, bounded message, no raw SQLite text or out-of-project path. A label-policy read failure only empties `effective` with `board.store.policy`.
- [x] R3 — `packages/kk-store/src/dao/collect-view.ts` `CollectViewDao` (read-only, exported, `Store.collectView`) provides `runRows(runIds)`, `lastStoredAt()`, `labelQuality(runId)`, `itemsPage(runId, filter, page)`, `itemSources()`; `packages/kk-store/src/migrations.ts` exports `unknownKkMigrationIds(adapter)` and `applyKkMigrations` uses it (no behaviour change).
- [x] R4 — `GET /api/workflows/kk-collect/store/overview?runs=<id>,…` (1–25 ids, each matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`) returns `CollectStoreOverview`: `lastStoredAt` and `rows[runId]` = `CollectRunStoreRow` or `null` when no `collect_runs` row exists. No Spur call.
- [x] R5 — `CollectRunStoreRow` carries `sourceCounts` (parsed `source_counts_json`, invalid JSON → `{}` + diagnostic), `inserted`, `updated`, `labelRows`, `labeledItems` (distinct items), `labelRowsBySource`, and `yield` over items with `first_seen_run = run` using each item's strongest status published > selected > dropped.
- [x] R6 — `GET /api/workflows/kk-collect/runs/<id>/store` (capture-free `authorizeRun`) returns `CollectRunStore`: the row plus per-decision `labelQuality` — run rows by value × HIGH/MEDIUM/LOW/none, and `effective` via `LabelsDao.currentFor(ids, policy)`.
- [x] R7 — `GET /api/workflows/kk-collect/runs/<id>/store/items` (capture-free `authorizeRun`) returns `CollectStoreItems`, 25 per page, items with `first_seen_run` or `last_seen_run` = run; filters `page` (≥1), `source` (∈ `itemSources()`), `seen` (new|reseen), `decision` (∈ `ITEM_DECISION_IDS`) + `value` (`[A-Za-z0-9._-]{1,64}`, both or neither), `selection` (selected|published|dropped|none); anything else → 400 `board.query.invalid`; no body field; title ≤300 chars; `url` only when http(s).
- [x] R8 — Shipped loopback/host/origin/method refusals apply unchanged; `authorizeRun` keeps the shipped project-mismatch (403), authority-unavailable (503) and run/workflow mismatch codes; `authorize()` delegates to it so shipped routes behave identically; only the three store routes accept query parameters.
- [x] R9 — Response types in `apps/board/src/contracts.ts` (type-only export); `docs/04_DESIGN.md` `kk board` section documents routes, queries, shapes and availability codes in the same commit.

**Out of scope:** UI (0308); installed-Board check (0309); any store write, schema change or `kk-collect.yaml` change; store views for the other two modules.

### Acceptance Criteria

- [x] AC1 — The reader opens the kk store read-only
- [x] AC2 — An unavailable store degrades only the store panels
- [x] AC3 — Store routes keep the reader's security envelope
- [x] AC4 — Decision and surface docs are updated with the change

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

- `packages/kk-store/src/migrations.ts:258` — exported `unknownKkMigrationIds(adapter, migrations = KK_MIGRATIONS)`; `applyKkMigrations` now calls it (`:318`) so the write guard and the reader's read-only guard share one definition (no behaviour change).
- `packages/kk-store/src/dao/collect-view.ts:138` — new read-only `CollectViewDao extends BaseDao` (ETL/analytics tier: the adapter stays `protected`, `Store` never widens to a raw adapter).
- `packages/kk-store/src/dao/collect-view.ts:152` — `runRows(runIds)`: one GROUP BY per table (inserted/updated + `source_counts_json` verbatim); `labelRows` counts observations, `labeledItems` a separate `COUNT(DISTINCT item_id)` keyed by `run_id` alone (`:168`) so a run whose rows span several sources still reports its true distinct-item count; plus yield.
- `packages/kk-store/src/dao/collect-view.ts:76` — `SELECTION_RANK_SQL` (`MAX(CASE status …)` published>selected>dropped): one definition shared by yield, the `selection` filter and each item's status.
- `packages/kk-store/src/dao/collect-view.ts:220` — `lastStoredAt()` = `max(finished_at)` as RFC 3339, `null` when no row.
- `packages/kk-store/src/dao/collect-view.ts:229` — `labelQuality(runId)`: per decision, value × HIGH/MEDIUM/LOW/none (a `null` confidence is `none`, not dropped).
- `packages/kk-store/src/dao/collect-view.ts:258` — `labeledItemIds(runId)` — the population the `effective` list is computed over.
- `packages/kk-store/src/dao/collect-view.ts:267` — `itemSources()` — the `source` filter's domain (distinct, non-empty).
- `packages/kk-store/src/dao/collect-view.ts:279` — `itemsPage(runId, filter, page, policy)`: 25/page, `first_seen_run OR last_seen_run = run`, every filter bound in SQL; the decision/value filter matches `labels_current` (stale observations and `default` rows cannot match).
- `packages/kk-store/src/dao/collect-view.ts:362` — `currentLabels(ids, policy)`: the page's effective labels through the shipped `labels_current` CTE.
- `packages/kk-store/src/db.ts:34,76` — `Store.collectView`, wired in `openStore`; `packages/kk-store/src/db.ts:69` keeps `migrate:false` as "no DDL, no journal write" (unchanged).
- `packages/kk-store/src/index.ts:38,67` — exports `CollectViewDao`, its record types, `COLLECT_VIEW_PAGE_SIZE` and `unknownKkMigrationIds`.
- `apps/cli/src/board/collect-store.ts:92` — `sessionFor`: `stat` the path first (missing → no `openStore`, so nothing is created), `openStore({migrate:false})`, `unknownMigrationIds()` → `board.store.newer`, `finally` close; a policy read failure only pushes `board.store.policy`.
- `apps/cli/src/board/collect-store.ts:158` — `storeOverview`: `rows[runId] = null` for a run with no `collect_runs` row, never zeros; query failure → `board.store.unreadable` with empty shapes.
- `apps/cli/src/board/collect-store.ts:124` — `sourceCountsOf`: invalid JSON (or a non-object) → `{}` + `board.store.row-invalid`; non-numeric counts are dropped, not guessed.
- `apps/cli/src/board/collect-store.ts:212` — `storeRun`: the stored row plus `labelQuality` (this run's own rows) and `effective` via `LabelsDao.currentFor(ids, policy)`.
- `apps/cli/src/board/collect-store.ts:285` — `storeItems`: the page, `sources`, and `null` when `source` is outside the store's own values (the reader answers 400); `itemOf` (`:267`) caps titles at 300 and links only http(s) URLs.
- `apps/cli/src/board/reader.ts:254` — `authorizeRun`: the project + Spur run-detail half of `authorize`, capture-free, so store routes serve runs that predate capture; `authorize()` (`:217`) now delegates to it, keeping every shipped refusal code.
- `apps/cli/src/board/reader.ts:609` — the three store routes are matched before the shipped dispatch; a workflow other than `kk-collect` is `404 board.route.unknown`; `…/runs/<id>/store` refuses every query parameter (`:627`, design §3 "Query: none").
- `apps/cli/src/board/reader.ts:648` — `parseQuery` moved after route matching: only the store routes parse parameters, every shipped route keeps refusing all of them.
- `apps/cli/src/board/reader.ts:712,733` — `parseRunsQuery` (1–25 safe ids, deduplicated, no other key) and `parseItemsQuery` (`page`,`source`,`seen`,`decision`+`value`,`selection`; anything else → 400 `board.query.invalid`).
- `apps/board/src/contracts.ts:121-190` — type-only `CollectStoreAvailability`, `CollectRunStoreRow`, `CollectStoreOverview`, `CollectRunStore`, `CollectStoreItem`, `CollectStoreItems` (frozen names, §3 shapes).
- `docs/04_DESIGN.md:382` — `kk board` section: the three routes, their queries, the shapes, the read-only contract and every availability code, in the same change set (AC4).
- Tests: `packages/kk-store/tests/dao/collect-view.test.ts` (12 cases), `apps/cli/tests/board/collect-store.test.ts` (14), `apps/cli/tests/board/collect-store-fixture.ts` (shared seeded store), `apps/cli/tests/board/reader.test.ts` (6 new store-route cases).

#### G81 force re-verification — 2026-10-17

Fixed the adapter constructor WAL default at `packages/kk-store/src/db.ts:79`. The existing wrapper-only guard did not prevent DELETE-mode conversion. Strengthened the real-file integration at `packages/kk-store/tests/kk-store.test.ts:213` to start from DELETE mode and compare file bytes; reproduced failure before the fix. No API, schema or writer behavior change. Logs: `.spur/run/g81-reverify/readonly-red.log` and `.spur/run/g81-reverify/readonly-green.log`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/cli/src/board/collect-store.ts` lstat-first + `openStore({migrate:false})` + finally-close; read-only adapter pragma at `packages/kk-store/src/db.ts:79`; real DELETE-mode store regression `packages/kk-store/tests/kk-store.test.ts:213`. |
| R2 | MET | `board.store.unreadable` / `board.store.newer` / `board.store.policy` unavailable shapes — `apps/cli/tests/board/collect-store.test.ts` (52 pass / 0 fail across 3 files this run). |
| R3 | MET | Read-only `CollectViewDao` at `packages/kk-store/src/dao/collect-view.ts`; `unknownKkMigrationIds` exported at `packages/kk-store/src/migrations.ts:258` and used by `applyKkMigrations` at `packages/kk-store/src/migrations.ts:318`. |
| R4 | MET | Overview route with 1–25 id validation — collect-store route tests green this run. |
| R5 | MET | `CollectRunStoreRow` sourceCounts/inserted/updated/labelRows/labeledItems/yield — same suite. |
| R6 | MET | Per-run store route with labelQuality and effective policy labels — same suite. |
| R7 | MET | Items route: 25/page, filter validation, 400 `board.query.invalid` — same suite. |
| R8 | MET | Security envelope refusals unchanged — `apps/cli/tests/board/reader.test.ts:672` (green this run). |
| R9 | MET | Response types in `apps/board/src/contracts.ts:127`; routes documented in `docs/04_DESIGN.md:383`; dated ADR note `docs/00_ADR.md:1331`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — The reader opens the kk store read-only | MET | test | `apps/cli/tests/board/collect-store.test.ts` + `apps/cli/tests/board/reader.test.ts` + `packages/kk-store/tests/kk-store.test.ts`: 52 pass / 0 fail (bun test, this run); mode/schema/counts regression `packages/kk-store/tests/kk-store.test.ts:213`. |
| Scenario: R2 — An unavailable store degrades only the store panels | MET | test | Missing/corrupt/newer/policy cases in `apps/cli/tests/board/collect-store.test.ts` (52 pass / 0 fail this run). |
| Scenario: R8 — Store routes keep the reader's security envelope | MET | test | Envelope refusals `apps/cli/tests/board/reader.test.ts:672`; query parsing `apps/cli/src/board/reader.ts:626`, `apps/cli/src/board/reader.ts:733`. |
| Scenario: R10 — Decision and surface docs are updated with the change | MET | command | grep/read this run: typed contracts `apps/board/src/contracts.ts:127`; documented routes `docs/04_DESIGN.md:383`; dated permission `docs/00_ADR.md:1331`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS

#### Review Report — 0307 (G81 Collect store views, re-review after remediation)
**Scope:** `git diff HEAD` + untracked (`apps/cli/src/board/collect-store.ts`, `packages/kk-store/src/dao/collect-view.ts`, `apps/cli/tests/board/collect-store.test.ts`, `apps/cli/tests/board/collect-store-fixture.ts`, `packages/kk-store/tests/dao/collect-view.test.ts`), read against `docs/design/collect-store-views.md` §1/§3, the ADR-035 amendment 2026-10-16 (`docs/00_ADR.md:1331-1347`) and R1–R9/AC1–AC4 of the task file.
**Dimensions:** functional traceability (R1–R9, AC1–AC4), SECUA quality, architectural depth.
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | Test-only residue of the previous P2: the app-level fixture still cannot discriminate, because its per-source distinct counts (`heuristic` 2 items, `model` 1 item) both fold to the true total, so `labeledItems: 2` at `apps/cli/tests/board/collect-store.test.ts:160` would also pass on the old `Math.max` fold. The discriminating regression lives one layer down (`packages/kk-store/tests/dao/collect-view.test.ts:120-134`, one item per source) and the product fix was independently reproduced (see below), so this is a fixture gap, not a defect. | `apps/cli/tests/board/collect-store-fixture.ts:60-71` | ACCEPTED |
| 2 | P4 (advisory) | correctness | `openStore` executes `PRAGMA journal_mode = WAL` before the `migrate === false` branch, so a store that is not already in WAL has its header converted on the reader's first open. R1's letter (no write/DDL/migration, `sqlite_master` + row counts unchanged) holds and is tested, and the behaviour is pre-existing in `openStore` (shared with `apps/cli/src/commands/daily.ts:150`), not introduced here. | `packages/kk-store/src/db.ts:66-72` | ACCEPTED |
| 3 | P4 (advisory) | architecture | The status→rank rule still exists twice in TypeScript: `SELECTION_RANK_SQL` and the literal `{selected: 2, published: 3, dropped: 1}` used to build the `selection` filter; likewise the run-id rule exists as `RUN_ID_PATTERN` and inline in `identify`. Carried from attempt 1; the SQL and the literal must stay in step. | `packages/kk-store/src/dao/collect-view.ts:76,288-292`; `apps/cli/src/board/reader.ts:687,801` | ACCEPTED |
| 4 | P4 (advisory) | security | The store branch adds one instance of the shipped `decodeURIComponent`-throw class (malformed percent-encoding in the workflow segment). Pre-existing pattern on the shipped paths (`identify`, artifact ids); not introduced by this task's logic. | `apps/cli/src/board/reader.ts:617` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `apps/cli/src/board/collect-store.ts:92-101` (`stat` first → `board.store.missing`, never `openStore` on an absent path), `:103` `openStore({migrate:false})`, `finally` close in all three projections (`:200,265,347`); read-only digest test over `sqlite_master` + five row counts across all three views `apps/cli/tests/board/collect-store.test.ts:145-155`; "no file appeared" assertion `:104`. `stat` vs `lstat` wording noted as finding 2's neighbourhood (P4, accepted) |
| R2 | MET | Bounded, path-free codes `collect-store.ts:44-68`; newest-journal guard `:120-128`; policy failure only empties `effective` `:112-118`; query failure → `unavailable` + empty shapes `:196-206,279-289`; tests `collect-store.test.ts:107-143,175-193,243-255` (incl. `JSON.stringify(diagnostics)` contains no project path) |
| R3 | MET | `CollectViewDao` read-only and exported `packages/kk-store/src/dao/collect-view.ts:139`, wired `db.ts:34,76`, exported `index.ts:30-39`; `runRows/lastStoredAt/labelQuality/labeledItemIds/itemSources/itemsPage` all present; `unknownKkMigrationIds` exported `migrations.ts:258-267` and reused by `applyKkMigrations:318` with identical message/behaviour |
| R4 | MET | Route `reader.ts:609-624`; `parseRunsQuery` 1–25 ids vs `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, dedup, every other key refused `:719-733`; no `boardGet` on this path (test `reader.test.ts:610-625` serves rows while the Board reports a foreign project); `rows[runId] = null` for a run without a row `collect-store.ts:170-180` |
| R5 | MET | **P2 fix verified**: `labeledItems` is now its own per-run `SELECT run_id, COUNT(DISTINCT item_id) … GROUP BY run_id` (`collect-view.ts:171-180`) merged into `labelRows`/`labelRowsBySource` (`:189-215`) without changing those units; independent probe (2 items, `heuristic` on a+b, `model` on b+c) returned `{labelRows:4, labeledItems:3, bySource:{heuristic:2,model:2}}` — the old `Math.max` fold would answer 2. Regression test `collect-view.test.ts:120-134`; `sourceCounts` parse + `board.store.row-invalid` `collect-store.ts:132-156` (tests `collect-store.test.ts:195-232`); yield precedence single definition `collect-view.ts:76,297` (test `:160-185`) |
| R6 | MET | `storeRun` via capture-free `authorizeRun` (`reader.ts:626-648,254-317`); `labelQuality` = this run's own rows per decision × HIGH/MEDIUM/LOW/none (`collect-view.ts:229-256`, `none` keeps null confidence), `effective` via `labels.currentFor(ids, policy)` (`collect-store.ts:238-252`); tests `collect-store.test.ts:239-255` (histogram `{HIGH:1,none:2}`, `effective [{ai-news,2}]`) |
| R7 | MET | Population `first_seen_run OR last_seen_run = run`, every filter bound in SQL, 25/page (`collect-view.ts:279-350`); `parseItemsQuery` domain-checks `page/source/seen/decision+value/selection` and refuses every other key (`reader.ts:741-790`); a `source` outside `itemSources()` → 400 (`reader.ts:640-648`, test `reader.test.ts:690-719`); no `body` column selected; title capped at 300, non-http(s) URL nulled (`collect-store.ts:264-278`, tests `collect-store.test.ts:283-302`) |
| R8 | MET | Loopback/host/origin/method refusals before route matching (`reader.ts:593-608`); `authorizeRun` keeps 403 project-mismatch / 503 authority-unavailable / 404 run-unknown and `authorize()` delegates to it (`:217-252`); **P3 fix verified**: the `…/store` route now runs the shipped `parseQuery` (`reader.ts:625-631`, test `reader.test.ts:664-670`: `?page=2` → 400 `board.query.invalid`), `parseQuery` moved after route matching so shipped routes still refuse all parameters (`reader.ts:644-648`, test `reader.test.ts:722`), and all three store routes now declare-or-refuse (overview `:618-621`, run `:625-631`, items `:741-790`) — the class is swept, three of three |
| R9 | MET | Type-only contracts `apps/board/src/contracts.ts:112-190`; `docs/04_DESIGN.md:382-413` documents the three routes, their queries, the shapes, the read-only contract and all five availability codes in the same change set; ADR-035 amendment present at `docs/00_ADR.md:1331-1347` |
| AC1 | MET | R1 evidence above |
| AC2 | MET | R2 evidence above: unavailable answers are empty shapes + a diagnostic, never a zero that reads as a stored fact |
| AC3 | MET | R8 evidence above (origin 403, project 403, unknown run 404, unreachable Board 503, non-collect workflow 404) |
| AC4 | MET | R9 evidence above |

**Verification run by this review (fresh):** `bun test packages/kk-store/tests/dao/collect-view.test.ts apps/cli/tests/board/collect-store.test.ts apps/cli/tests/board/reader.test.ts` → **55 pass / 0 fail, 248 expect() calls** (the two remediation regression tests execute inside it). `collect-view.ts` reports 100% lines/functions. No new defect found in the changed aggregate query shape: `runRows` issues three SELECTs over the same bound `run_id IN (…)` list, keeps `labelRows` counting observations and `labelRowsBySource` keyed by `source`, and `labeledItems` is now independent of the source grouping; runs without a `collect_runs` row still return no entry (never a zero row).

**Independent reproduction of the P2 fix:** temporary probe against a real temp store seeded through the real DAOs (`packages/kk-store/.probe-review-0307.ts`, deleted immediately; `git status` clean): 3 items in `run-1`, `heuristic` labels on items a+b, `model` labels on b+c → `runRows(['run-1'])` = `{labelRows: 4, labeledItems: 3, labelRowsBySource: {heuristic: 2, model: 2}}`. The pre-fix implementation could only have produced 2 here.

**Assumption named for the reader:** the P3 fix was confirmed by the shipped regression test and by source reading of the route order, not by a hand-driven HTTP probe of a live reader (no server was started for this review).

**Next:** none — PASS. Rows 1–4 are P4 observations; no P1–P3 finding is open.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-17T06:09:51.123Z todo → wip (system)
- 2026-10-17T06:44:47.492Z wip → testing (system)
- 2026-10-17T06:45:04.898Z testing → done (system)

