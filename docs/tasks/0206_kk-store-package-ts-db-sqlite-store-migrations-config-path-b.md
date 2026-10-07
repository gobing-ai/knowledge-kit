---
schema_version: 1
name: "kk-store package: ts-db SQLite store, migrations, config path, boundary rules"
status: done
template: feature-impl
created_at: 2026-10-07T03:58:06.070Z
updated_at: "2026-10-07T07:14:00.340Z"
feature_id: G31
priority: P1
tags:
  - kk-store
  - sqlite
  - ts-db
estimate_hours: 6

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/0206-verdict.json
---

## 0206. kk-store package: ts-db SQLite store, migrations, config path, boundary rules

### Background

Implements: R3 — Store path resolves from kk config with a works-dir default; R4 — ts-db and drizzle imports are confined to the kk-store package; R5 — Store schema evolves only through versioned migrations.

Foundation slice of feature Q (ADR-030). Design: docs/design/kk-collect-and-daily-voice2.md §2. Pattern source: spur packages/domain (src/db.ts, src/schema/, drizzle/, .spur/rules/boundary/dao-boundary.yaml).

### Requirements

- [x] R1. New workspace `packages/kk-store` (`@gobing-ai/kk-store`, `private: true`, `exports: { ".": "./src/index.ts" }`, scripts `test` + `typecheck` copied from `packages/publish-harness/package.json`) depends on `@gobing-ai/ts-db` via `catalog:`; `src/index.ts` exports `openStore`, `resolveStorePath`, `canonicalUrl`, the DAO classes and row types only.
- [x] R2. `openStore({ path })` lazily imports `createDbAdapter` from `@gobing-ai/ts-db`, opens `{ driver: 'bun-sqlite', url: path }`, runs `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 30000` through `adapter.exec`, then `applyKkMigrations(adapter)`; a failed migration closes the adapter before rethrowing (spur `packages/domain/src/db.ts:32-80`).
- [x] R3. Schema v1 in `src/schema/{items,collect-runs,labels,episode-usage,locks}.ts` via `defineTable` + `text`/`integer` builders from `@gobing-ai/ts-db/schema` (spur `schema/runs.ts`), columns per design §2. Migration `0001_kk_store_init` = the five `<table>.createTableSql` strings plus indexes (`labels(item_id, decision_id)` UNIQUE, `episode_usage(workflow, item_id)`), journaled in `__kk_store_migrations(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`; read-only fast path when every id is journaled (spur `migrations.ts:1601-1632`). No hand-written DDL file.
- [x] R4. DAOs in `src/dao/*.ts` extend `EntityDao` (`super(adapter, table, [table.id], '<name>')`, spur `dao/artifact-dao.ts`): `ItemsDao.upsertDocs(runId, docs) → { inserted, updated, unchanged, newIds }` in one transaction; a `content_hash` change deletes that item's `labels` rows; `CollectRunsDao`, `LabelsDao`, `EpisodeUsageDao`, `LocksDao` (`acquire(name, runId, ttlMs) → boolean`, `release(name, runId)`).
- [x] R5. `canonicalUrl(url)` is pure: lowercases scheme and host, drops the fragment, drops `utm_*`, `ref`, `ref_src`, `fbclid` and `gclid`, sorts the remaining query params and strips the trailing `/` (except at the root). `itemId = sha256(canonicalUrl)`, or `sha256(title + body)` when the Doc has no URL (`sourceUri`, falling back to `metadata.originalUrl`).
- [x] R6. `resolveStorePath(configFile = resolveKkConfigPath())` reads `store.db_path` with `Bun.YAML.parse`, expands a leading `~`, resolves relative paths against cwd, defaults to `.works/kk.db` and creates the parent dirs. `resolveKkConfigPath` moves from `apps/cli/src/invoke.ts:52` to `@gobing-ai/kk-core` only if kk-store cannot import apps/cli; otherwise kk-store takes the path as an argument and apps/cli passes it.
- [x] R7. `kk store migrate [--db <path>]` lives in `apps/cli/src/commands/store.ts` (`registerStoreCommand`, wired in `apps/cli/src/cli.ts`). It prints `{ "db": <path>, "applied": <n> }`, is idempotent, and exits 1 with `kk.store.migrate.failed: <cause>` on error.
- [x] R8. Retarget the scaffolded `.spur/rules/boundary/dao-boundary.yaml` (written for spur's `packages/domain`) to `packages/kk-store`: `ts-db-only-in-kk-store` covers `apps/**`, `packages/**` (except kk-store) and `plugins/**/src/**`; `drizzle-only-in-kk-store-schema`; `tables-via-defineTable`; `raw-sql-only-in-kk-store`; drop the `apps/cli/src/index.ts` spur exemption. `bun run test-pre-check` passes, and a planted violation fails it.

### Acceptance Criteria

- [x] AC1 — Store path resolves from kk config with a works-dir default
- [x] AC2 — ts-db and drizzle imports are confined to the kk-store package
- [x] AC3 — Store schema evolves only through versioned migrations

Testing: before writing code, list every way the unit can fail (failure-first list in the task), then code; prove behavior with one E2E-style bun:test over a temp dir / temp DB, leaving a repeatable artifact under .works/test-artifacts/.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T03:59:05.728Z

- Default path when `store.db_path` is unset: `.works/kk.db`, cwd-relative (same anchor as today's `.works/` run dirs). Chosen for zero-config dogfood.
- Boundary rules copied now: `ts-db-only-in-kk-store` and `drizzle-only-in-kk-store-schema`. spur's `tables-via-defineTable` and `raw-sql-only-in-domain` are deferred. Add them when a second DAO author or raw SQL shows up.
- Config read reuses `resolveKkConfigPath` (apps/cli/src/invoke.ts:52). No new loader.

- **Q (2026-10-07 refine):** New rule file or reuse? **A:** Reuse — `.spur/rules/boundary/dao-boundary.yaml` already exists (scaffolded for spur's `packages/domain`); retarget it to `packages/kk-store` (R8). Migrations are embedded `KkMigration[]` (no `drizzle/*.sql`), mirroring spur `applyCliMigrations`.

### Design

Chosen: mirror spur `packages/domain` (adapter `src/db.ts`, tables `src/schema/`, DAOs `src/dao/`, embedded migrations `src/migrations.ts`), because the operator mandated that pattern. Verified against spur-new at ts-db 0.5.16:
- DDL comes from `defineTable(...).createTableSql` (`packages/domain/src/schema/index.ts:17-31`), so there is no `drizzle/*.sql` to drift.
- ts-db also exports a folder-based `applyMigrations(adapter, { migrationsFolder })` (`dist/migrate.d.ts`). It is rejected because the bundled `kk` binary has no migrations folder on disk, which is why spur journals embedded migrations too.
- `busy_timeout` goes through `exec`, because ts-db's typed pragmas accept only journalMode/synchronous/foreignKeys.

Rejected: plain `bun:sqlite` (violates the ts-db mandate); store inside kk-core (pure contracts, no IO).
Invariants:
- No ts-db type crosses `src/index.ts`; consumers see `Store` and the DAO methods only.
- Migrations are append-only `{ id, sql }`, applied in order and journaled once.
- WAL + busy_timeout are set on every open.
- ts-db is imported lazily so `import '@gobing-ai/kk-store'` costs nothing until `openStore`.

Files: `packages/kk-store/{package.json,tsconfig.json,src/index.ts,src/db.ts,src/migrations.ts,src/canonical-url.ts,src/config.ts,src/schema/*.ts,src/dao/*.ts,tests/kk-store.test.ts}`, `apps/cli/src/commands/store.ts`, `apps/cli/src/cli.ts`, `apps/cli/package.json` (`@gobing-ai/kk-store: workspace:*`), `.spur/rules/boundary/dao-boundary.yaml`, `docs/04_DESIGN.md` (kk store row), `bun.lock` (catalog dependency lock entry). The spawned-CLI test for `kk store migrate` lives at `apps/cli/tests/commands/store.test.ts`.
Key signatures:
- `openStore(opts: { path: string }): Promise<Store>`
- `interface Store { items: ItemsDao; collectRuns: CollectRunsDao; labels: LabelsDao; usage: EpisodeUsageDao; locks: LocksDao; close(): Promise<void> }`
- `applyKkMigrations(adapter, migrations = KK_MIGRATIONS): Promise<number>`
- `canonicalUrl(url: string): string`
- `resolveStorePath(configFile: string): string`

### Plan

- [x] Failure-first list in the test file header (unwritable parent dir, corrupt file, migrate rerun, two concurrent openers, URL edge cases: no scheme, IDN host, only-tracking query, fragment-only).
- [x] Scaffold `packages/kk-store` from publish-harness's package.json/tsconfig; `bun install`.
- [x] `src/schema/*.ts` + `src/migrations.ts` (`KK_MIGRATIONS`, `applyKkMigrations`) + `src/db.ts` (`openStore`).
- [x] `canonical-url.ts`, `config.ts`, the five DAOs.
- [x] `apps/cli/src/commands/store.ts` with `migrate`; register in `cli.ts`.
- [x] Retarget `dao-boundary.yaml`; prove it with a temporary violating import, then remove it.
- [x] E2E `packages/kk-store/tests/kk-store.test.ts` over a temp dir: migrate twice (`applied` 1 then 0), `PRAGMA journal_mode` = wal and `busy_timeout` = 30000, upsert insert/update/unchanged, a hash change clears labels, lock contention; plus `kk store migrate` spawned against `--db <tmp>`. Copy the DB and stdout to `.works/test-artifacts/0206/`.
- [x] `docs/04_DESIGN.md` kk store row in the same commit; `bun run gate`.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/package.json:50` |
| `apps/cli/src/cli.ts:25` |
| `apps/cli/src/cli.ts:5` |
| `apps/cli/src/commands/store.ts:1` |
| `apps/cli/tests/commands/store.test.ts:1` |
| `apps/cli/tests/kk-daily-ai-voice-workflow.test.ts:720` |
| `apps/cli/tests/main.test.ts:52` |
| `apps/cli/tests/main.test.ts:59` |
| `apps/cli/tests/main.test.ts:64` |
| `docs/04_DESIGN.md:340` |
| `docs/04_DESIGN.md:470` |
| `docs/04_DESIGN.md:65` |
| `docs/04_DESIGN.md:74` |
| `docs/04_DESIGN.md:77` |
| `docs/features/G11_kk-daily-ai-voice2-dag-daily-workflow-from-the-store-cut-over.md:9` |
| `docs/features/G11_kk-daily-ai-voice2-dag-daily-workflow-from-the-store-cut-over.md:99` |
| `docs/features/G31_kk-collect-kk-daily-ai-voice2-sqlite-store-decision-labels-dag-daily-workflow-run-ledger.md:147` |
| `docs/features/G31_kk-collect-kk-daily-ai-voice2-sqlite-store-decision-labels-dag-daily-workflow-run-ledger.md:164` |
| `docs/features/G31_kk-collect-kk-daily-ai-voice2-sqlite-store-decision-labels-dag-daily-workflow-run-ledger.md:168` |
| `docs/features/G31_kk-collect-kk-daily-ai-voice2-sqlite-store-decision-labels-dag-daily-workflow-run-ledger.md:173` |
| `docs/features/G31_kk-collect-kk-daily-ai-voice2-sqlite-store-decision-labels-dag-daily-workflow-run-ledger.md:178` |
| `docs/features/G31_kk-collect-kk-daily-ai-voice2-sqlite-store-decision-labels-dag-daily-workflow-run-ledger.md:5` |
| `docs/features/G31_kk-collect-kk-daily-ai-voice2-sqlite-store-decision-labels-dag-daily-workflow-run-ledger.md:9` |
| `docs/features/INDEX.md:63` |
| `docs/features/INDEX.md:83` |
| `docs/tasks/0211_kk-daily-ai-voice2-dag-workflow-with-safety-sub-workflow-and.md:105` |
| `docs/tasks/0211_kk-daily-ai-voice2-dag-workflow-with-safety-sub-workflow-and.md:54` |
| `docs/tasks/0211_kk-daily-ai-voice2-dag-workflow-with-safety-sub-workflow-and.md:7` |
| `docs/tasks/0213_verify-the-confidence-level-high-medium-low-on-kk-collect-an.md:1` |
| `packages/kk-store/package.json:1` |
| `packages/kk-store/src/canonical-url.ts:1` |
| `packages/kk-store/src/config.ts:1` |
| `packages/kk-store/src/dao/collect-runs.ts:1` |
| `packages/kk-store/src/dao/episode-usage.ts:1` |
| `packages/kk-store/src/dao/items.ts:1` |
| `packages/kk-store/src/dao/labels.ts:1` |
| `packages/kk-store/src/dao/locks.ts:1` |
| `packages/kk-store/src/db.ts:1` |
| `packages/kk-store/src/index.ts:1` |
| `packages/kk-store/src/migrations.ts:1` |
| `packages/kk-store/src/schema/collect-runs.ts:1` |
| `packages/kk-store/src/schema/episode-usage.ts:1` |
| `packages/kk-store/src/schema/index.ts:1` |
| `packages/kk-store/src/schema/items.ts:1` |
| `packages/kk-store/src/schema/labels.ts:1` |
| `packages/kk-store/src/schema/locks.ts:1` |
| `packages/kk-store/tests/canonical-url.test.ts:1` |
| `packages/kk-store/tests/config.test.ts:1` |
| `packages/kk-store/tests/dao/collect-runs.test.ts:1` |
| `packages/kk-store/tests/dao/episode-usage.test.ts:1` |
| `packages/kk-store/tests/dao/items.test.ts:1` |
| `packages/kk-store/tests/dao/labels.test.ts:1` |
| `packages/kk-store/tests/dao/locks.test.ts:1` |
| `packages/kk-store/tests/helpers.ts:1` |
| `packages/kk-store/tests/kk-store.test.ts:1` |
| `packages/kk-store/tsconfig.json:1` |
| `scripts/publish-manifest.test.ts:84` |
| `scripts/publish-manifest.test.ts:94` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/kk-store/package.json:1-21` — `"name": "@gobing-ai/kk-store"`, `"private": true`, `"exports": { ".": "./src/index.ts" }`, `test`+`typecheck` scripts matching `packages/publish-harness/package.json:9-12`, `"@gobing-ai/ts-db": "catalog:"` (catalog `^0.5.15` at `package.json:15`). `packages/kk-store/src/index.ts:10-26` exports `openStore`, `resolveStorePath`, `canonicalUrl`, `itemId`, the five DAO classes and row types; hand-checked all export lines — no ts-db type appears in any exported signature. Superset of R1's enumeration: `SQLITE_BUSY_TIMEOUT_MS` and `DEFAULT_STORE_DB_PATH` are also exported (benign, documented in `docs/04_DESIGN.md:470` onward); `itemId` is mandated by R5. Extra dep `@gobing-ai/ts-runtime` (catalog) is required by the repo's `no-direct-fs-io` rule (`packages/kk-store/src/config.ts:3`) — widens R1's declared dep set, justified. |
| R2 | MET | `packages/kk-store/src/db.ts:47-72`: lazy `await import('@gobing-ai/ts-db')` at `:48`, `createDbAdapter({ driver: 'bun-sqlite', url: options.path })` at `:49`, `adapter.exec('PRAGMA journal_mode = WAL')` at `:51`, ``PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`` via `exec` at `:52` (`SQLITE_BUSY_TIMEOUT_MS = 30_000` at `:32`), `applyKkMigrations(adapter)` at `:53`, and close-before-rethrow in `catch` at `:65-70`. E2E asserts `journal_mode = wal` at `packages/kk-store/tests/kk-store.test.ts:110` and proves the 30 s timeout behaviorally against a 5.4 s competing writer (`packages/kk-store/tests/kk-store.test.ts:102-152`). |
| R3 | MET | Five tables via `defineTable` + `text`/`integer`/`standardColumns` from `@gobing-ai/ts-db/schema` (`packages/kk-store/src/schema/items.ts:1,10-24` and the four sibling modules). DDL is derived, not hand-written: `packages/kk-store/src/schema/index.ts:30-38` joins each `createTableSql` plus `labels (item_id, decision_id)` UNIQUE, `episode_usage (workflow, item_id)` index and the `episode_usage (item_id, workflow, run_id)` UNIQUE identity. `find packages/kk-store -name '*.sql'` → 0 files. Migrations are append-only: `packages/kk-store/src/migrations.ts:18` (`KK_MIGRATIONS = [{ id: '0001_kk_store_init', sql: KK_STORE_V1_SQL }]`); journal table `__kk_store_migrations(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)` at `packages/kk-store/src/migrations.ts:12,66`; read-only fast path `allMigrationsJournaled` at `packages/kk-store/src/migrations.ts:42-52`, short-circuit at `:63`. |
| R4 | MET | Five DAOs extend `EntityDao` with `super(adapter, table, [key], '<name>')`: `packages/kk-store/src/dao/items.ts:95-97`, `packages/kk-store/src/dao/labels.ts:27-29`, `packages/kk-store/src/dao/collect-runs.ts:28-30`, `packages/kk-store/src/dao/episode-usage.ts:20-22`, `packages/kk-store/src/dao/locks.ts:32-34`. `ItemsDao.upsertDocs(runId, docs) → { inserted, updated, unchanged, newIds }` at `packages/kk-store/src/dao/items.ts:112-180` builds one `adapter.batch(operations)` at `:178` (single transaction), and pushes `DELETE FROM labels WHERE item_id = ?` before the update on a `content_hash` change at `:155`. `LocksDao.acquire(name, runId, ttlMs) → boolean` is a single-statement `ON CONFLICT … DO UPDATE … WHERE` upsert with TTL steal at `packages/kk-store/src/dao/locks.ts:44-56`; `release` at `:58-65`. DAO tests pass under `bun test packages/kk-store`. |
| R5 | MET | `packages/kk-store/src/canonical-url.ts:46-63` `canonicalUrl` is pure (no IO, no clock): lowercases protocol + host, drops the fragment via URL rebuild, filters `utm_*` + `ref`/`ref_src`/`fbclid`/`gclid` (`TRACKING_PARAMS` at `:8-13`), sorts remaining params with a value tie-break (`:54-57`), strips the trailing `/` except root. `itemId` at `packages/kk-store/src/canonical-url.ts:82-88` = `sha256(canonicalUrl(...))` when the Doc has `sourceUri` (fallback `metadata.originalUrl`), else `sha256(title + body)`. `packages/kk-store/tests/canonical-url.test.ts:7-66` covers scheme+host lowercasing, fragment/tracking drop, sorting, root slash, scheme-less, IDN→punycode, tracking-only query, fragment-only, idempotence and both identity fallbacks. |
| R6 | MET | `packages/kk-store/src/config.ts:57-64`: explicit `--db` → `store.db_path` → `DEFAULT_STORE_DB_PATH = '.works/kk.db'` (`:6`); leading `~` expands (`:13-17`); relative resolves against cwd via `resolve` (`:61`) and `fileSystem.ensureDir(dirname(absolute))` creates parents (`:62`). `readStoreDbPath` at `:26-44` uses `Bun.YAML.parse` (`:36`) and yields `undefined` for missing/unreadable/unparseable/blank/non-object config so the default applies. The implementation is the R6-permitted argument-passing branch — `resolveStorePath(configFile?, explicitPath?)`, async over the ts-runtime `FileSystem` seam, because `apps/cli` depends on kk-store (never the reverse) and passes `resolveKkConfigPath()` from `apps/cli/src/commands/store.ts:22`. `packages/kk-store/tests/config.test.ts:9-89` covers default+parent creation, configured relative path, explicit-wins, `~`, and five unusable config shapes. The task's §Design still shows the sync `(configFile: string)` form — doc drift only, non-blocking. |
| R7 | MET | `apps/cli/src/commands/store.ts:20-35` implements `kk store migrate [--db <path>]`; prints `JSON.stringify({ db, applied })` via `consoleOutput.write` at `:26` from `store.appliedMigrations` (`:24`); on error writes `kk.store.migrate.failed: <cause>` to stderr (`:29-32`) and throws `CommanderError(1, …)` (`:33`). Registered at `apps/cli/src/commands/store.ts:43-51` and wired at `apps/cli/src/cli.ts:5,25`. `apps/cli/tests/commands/store.test.ts` (3 pass, re-run) proves `applied` 1 then 0 across two spawned runs (`:37-47`), the `store.db_path` fallback through the spawned CLI (`:64-77`), and exit 1 + stderr prefix for an unopenable DB (`:79-85`). |
| R8 | MET | `.spur/rules/boundary/dao-boundary.yaml:14-106` defines exactly the four retargeted rules — `ts-db-only-in-kk-store` (`:15-39`), `drizzle-only-in-kk-store-schema` (`:40-66`), `tables-via-defineTable` (`:67-86`), `raw-sql-only-in-kk-store` (`:87-106`) — scoped to `apps/**/src/**`, `packages/**/src/**`, `plugins/**/src/**` with the kk-store exclusions; the spur `apps/cli/src/index.ts` exemption and the two spur-only rules are absent. `bun run test-pre-check` → "All 51 rules passed" (re-run live). Planted `@gobing-ai/ts-db` import in `apps/cli/src/commands/` → `ERROR ts-db-only-in-kk-store … exit 1`, then green after removal (`.works/test-artifacts/0206/r8-planted-violation.txt`). Independent ripgrep over `apps packages plugins` for both module specifiers finds them only under `packages/kk-store/**`. Residual: only 1 of 4 rules has a planted-fire proof (P4). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Store path resolves from kk config with a works-dir default | MET | test | `bun test packages/kk-store` → 38 pass / 0 fail, incl. `packages/kk-store/tests/config.test.ts:9-19` (default `.works/kk.db` + parent dir created), `:21-33` (configured relative path), `:35-42` (explicit override), `:44-55` (`~`); `apps/cli/tests/commands/store.test.ts:64-77` proves the config fallback end-to-end through the spawned CLI. `resolveStorePath` itself at `packages/kk-store/src/config.ts:57-64`. |
| AC2 — ts-db and drizzle imports are confined to the kk-store package | MET | command | `bun run test-pre-check` → "All 51 rules passed" (`ts-db-only-in-kk-store`, `drizzle-only-in-kk-store-schema` among them), plus the planted-violation run reporting `ERROR ts-db-only-in-kk-store` exit 1 (artifact `.works/test-artifacts/0206/r8-planted-violation.txt`); an independent ripgrep over `apps packages plugins` for `@gobing-ai/ts-db` and `drizzle-orm` finds them only under `packages/kk-store/**`. Rule scopes at `.spur/rules/boundary/dao-boundary.yaml:15-66`. |
| AC3 — Store schema evolves only through versioned migrations | MET | test | `packages/kk-store/tests/kk-store.test.ts:66-100` observes `applied` 1 then 0 on reopen, the journal row `0001_kk_store_init`, all five tables and three indexes; `apps/cli/tests/commands/store.test.ts:37-62` repeats it through the spawned CLI and lands the DB + JSON artifact. DDL source is `createTableSql` (`packages/kk-store/src/schema/index.ts:30-38`), with no `.sql` file in the package; journal + append-only list at `packages/kk-store/src/migrations.ts:12,18,66`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T06:11:11.359Z todo → wip (system)
- 2026-10-07T07:09:50.612Z wip → testing (system)
- 2026-10-07T07:14:00.329Z testing → done (system)

