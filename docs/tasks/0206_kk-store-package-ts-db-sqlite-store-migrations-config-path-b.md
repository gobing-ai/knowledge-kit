---
schema_version: 1
name: "kk-store package: ts-db SQLite store, migrations, config path, boundary rules"
status: todo
template: feature-impl
created_at: 2026-10-07T03:58:06.070Z
updated_at: "2026-10-07T05:06:45.289Z"
feature_id: G31
priority: P1
tags:
  - kk-store
  - sqlite
  - ts-db
estimate_hours: 6

---

## 0206. kk-store package: ts-db SQLite store, migrations, config path, boundary rules

### Background

Implements: R3 — Store path resolves from kk config with a works-dir default; R4 — ts-db and drizzle imports are confined to the kk-store package; R5 — Store schema evolves only through versioned migrations.

Foundation slice of feature Q (ADR-030). Design: docs/design/kk-collect-and-daily-voice2.md §2. Pattern source: spur packages/domain (src/db.ts, src/schema/, drizzle/, .spur/rules/boundary/dao-boundary.yaml).

### Requirements

- [ ] R1. New workspace `packages/kk-store` (`@gobing-ai/kk-store`, `private: true`, `exports: { ".": "./src/index.ts" }`, scripts `test` + `typecheck` copied from `packages/publish-harness/package.json`) depends on `@gobing-ai/ts-db` via `catalog:`; `src/index.ts` exports `openStore`, `resolveStorePath`, `canonicalUrl`, the DAO classes and row types only.
- [ ] R2. `openStore({ path })` lazily imports `createDbAdapter` from `@gobing-ai/ts-db`, opens `{ driver: 'bun-sqlite', url: path }`, runs `PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 30000` through `adapter.exec`, then `applyKkMigrations(adapter)`; a failed migration closes the adapter before rethrowing (spur `packages/domain/src/db.ts:32-80`).
- [ ] R3. Schema v1 in `src/schema/{items,collect-runs,labels,episode-usage,locks}.ts` via `defineTable` + `text`/`integer` builders from `@gobing-ai/ts-db/schema` (spur `schema/runs.ts`), columns per design §2. Migration `0001_kk_store_init` = the five `<table>.createTableSql` strings plus indexes (`labels(item_id, decision_id)` UNIQUE, `episode_usage(workflow, item_id)`), journaled in `__kk_store_migrations(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`; read-only fast path when every id is journaled (spur `migrations.ts:1601-1632`). No hand-written DDL file.
- [ ] R4. DAOs in `src/dao/*.ts` extend `EntityDao` (`super(adapter, table, [table.id], '<name>')`, spur `dao/artifact-dao.ts`): `ItemsDao.upsertDocs(runId, docs) → { inserted, updated, unchanged, newIds }` in one transaction; a `content_hash` change deletes that item's `labels` rows; `CollectRunsDao`, `LabelsDao`, `EpisodeUsageDao`, `LocksDao` (`acquire(name, runId, ttlMs) → boolean`, `release(name, runId)`).
- [ ] R5. `canonicalUrl(url)` is pure: lowercases scheme and host, drops the fragment, drops `utm_*`, `ref`, `ref_src`, `fbclid` and `gclid`, sorts the remaining query params and strips the trailing `/` (except at the root). `itemId = sha256(canonicalUrl)`, or `sha256(title + body)` when the Doc has no URL (`sourceUri`, falling back to `metadata.originalUrl`).
- [ ] R6. `resolveStorePath(configFile = resolveKkConfigPath())` reads `store.db_path` with `Bun.YAML.parse`, expands a leading `~`, resolves relative paths against cwd, defaults to `.works/kk.db` and creates the parent dirs. `resolveKkConfigPath` moves from `apps/cli/src/invoke.ts:52` to `@gobing-ai/kk-core` only if kk-store cannot import apps/cli; otherwise kk-store takes the path as an argument and apps/cli passes it.
- [ ] R7. `kk store migrate [--db <path>]` lives in `apps/cli/src/commands/store.ts` (`registerStoreCommand`, wired in `apps/cli/src/cli.ts`). It prints `{ "db": <path>, "applied": <n> }`, is idempotent, and exits 1 with `kk.store.migrate.failed: <cause>` on error.
- [ ] R8. Retarget the scaffolded `.spur/rules/boundary/dao-boundary.yaml` (written for spur's `packages/domain`) to `packages/kk-store`: `ts-db-only-in-kk-store` covers `apps/**`, `packages/**` (except kk-store) and `plugins/**/src/**`; `drizzle-only-in-kk-store-schema`; `tables-via-defineTable`; `raw-sql-only-in-kk-store`; drop the `apps/cli/src/index.ts` spur exemption. `bun run test-pre-check` passes, and a planted violation fails it.

### Acceptance Criteria

- [ ] AC1 — Store path resolves from kk config with a works-dir default
- [ ] AC2 — ts-db and drizzle imports are confined to the kk-store package
- [ ] AC3 — Store schema evolves only through versioned migrations

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

Files: `packages/kk-store/{package.json,tsconfig.json,src/index.ts,src/db.ts,src/migrations.ts,src/canonical-url.ts,src/config.ts,src/schema/*.ts,src/dao/*.ts,tests/kk-store.test.ts}`, `apps/cli/src/commands/store.ts`, `apps/cli/src/cli.ts`, `apps/cli/package.json` (`@gobing-ai/kk-store: workspace:*`), `.spur/rules/boundary/dao-boundary.yaml`, `docs/04_DESIGN.md` (kk store row).
Key signatures:
- `openStore(opts: { path: string }): Promise<Store>`
- `interface Store { items: ItemsDao; collectRuns: CollectRunsDao; labels: LabelsDao; usage: EpisodeUsageDao; locks: LocksDao; close(): Promise<void> }`
- `applyKkMigrations(adapter, migrations = KK_MIGRATIONS): Promise<number>`
- `canonicalUrl(url: string): string`
- `resolveStorePath(configFile: string): string`

### Plan

- [ ] Failure-first list in the test file header (unwritable parent dir, corrupt file, migrate rerun, two concurrent openers, URL edge cases: no scheme, IDN host, only-tracking query, fragment-only).
- [ ] Scaffold `packages/kk-store` from publish-harness's package.json/tsconfig; `bun install`.
- [ ] `src/schema/*.ts` + `src/migrations.ts` (`KK_MIGRATIONS`, `applyKkMigrations`) + `src/db.ts` (`openStore`).
- [ ] `canonical-url.ts`, `config.ts`, the five DAOs.
- [ ] `apps/cli/src/commands/store.ts` with `migrate`; register in `cli.ts`.
- [ ] Retarget `dao-boundary.yaml`; prove it with a temporary violating import, then remove it.
- [ ] E2E `packages/kk-store/tests/kk-store.test.ts` over a temp dir: migrate twice (`applied` 1 then 0), `PRAGMA journal_mode` = wal and `busy_timeout` = 30000, upsert insert/update/unchanged, a hash change clears labels, lock contention; plus `kk store migrate` spawned against `--db <tmp>`. Copy the DB and stdout to `.works/test-artifacts/0206/`.
- [ ] `docs/04_DESIGN.md` kk store row in the same commit; `bun run gate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
