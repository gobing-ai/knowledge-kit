# kk-collect + kk-daily-ai-voice2 — store, labels, DAG, ledger

**Status:** proposed design (features G31 kk-collect, G11 voice2, G71 run ledger). Engine facts verified against
`@gobing-ai/ts-dual-workflow-engine@0.5.16` (`src/dag.ts`); store pattern mirrors spur
`packages/domain` (`src/db.ts`, `src/schema/`, `.spur/rules/boundary/dao-boundary.yaml`).
ADR-030 (store) and ADR-031 (DAG workflows) are the binding decisions.

## 1. Shape

```
launchd/cron (every 6h)                         operator / cron (daily)
        │                                                │
  kk-collect.yaml  (state-machine, 5 states)       kk-daily-ai-voice2.yaml  (kind: dag)
  lock → collect → store → label → ledger          extract → … fan-out … → fan-in → ledger
        │                │                                ▲
        └──── writes ────┴──► kk.db (WAL) ◄──── reads ────┘
                               items · collect_runs · labels · episode_usage
```

`kk-daily-ai-voice.yaml` stays untouched until cut-over (§8).

## 2. `@gobing-ai/kk-store` (new workspace `packages/kk-store`)

| Piece | Path | Mirrors spur |
| --- | --- | --- |
| Adapter + migrate | `src/db.ts` — `openStore({ path })`: `createDbAdapter({ driver: 'bun-sqlite', url })`, `PRAGMA journal_mode = WAL` + `PRAGMA busy_timeout = 30000` via `adapter.exec` (the typed pragmas option omits busy_timeout — spur `db.ts:38`), then `applyKkMigrations` | `packages/domain/src/db.ts` |
| Schema | `src/schema/*.ts` — tables via `defineTable(name, cols)` + column builders from `@gobing-ai/ts-db/schema` (spur `schema/runs.ts`); zero direct `drizzle-orm` imports | `packages/domain/src/schema/` |
| DAOs | `src/dao/{items,collect-runs,labels,episode-usage}.ts` extending ts-db `EntityDao` | `packages/domain/src/dao/` |
| Migrations | embedded `KkMigration[]` (`{id, sql}`) journaled in `__kk_store_migrations`; v1 DDL derived from each `defineTable(...).createTableSql` — no hand-written SQL file | spur `packages/domain/src/migrations.ts:1625` `applyCliMigrations` |
| Public API | `src/index.ts` — DAOs + `openStore` + row types; no ts-db types leak | — |

`@gobing-ai/ts-db` is already in the root catalog (`^0.5.15`); `kk-store` consumes it via
`catalog:` — no new third-party dependency.

### Tables (v1)

| Table | Key columns | Notes |
| --- | --- | --- |
| `items` | `id` (sha256 of canonical URL, or of body when URL-less), `canonical_url` UNIQUE NULL, `content_hash`, `title`, `body`, `source`, `media_type`, `metadata_json`, `first_seen_run`, `last_seen_run`, `first_seen_at`, `published_at` | Upsert on `id`; `content_hash` change ⇒ `labels` for that item are invalidated (re-label next run) |
| `collect_runs` | `run_id` PK, `started_at`, `finished_at`, `status`, `source_counts_json`, `inserted`, `updated` | provenance |
| `labels` | (`item_id`, `decision_id`) PK, `value`, `score` NULL, `maker`, `source` (`model`\|`heuristic`\|`default`), `labeled_at` | one row per decision per item |
| `episode_usage` | (`item_id`, `workflow`, `run_id`) PK, `used_at` | cross-day dedup (I18) |
| `locks` | `name` PK, `owner_run`, `acquired_at`, `ttl_ms` | single-flight (I19) |

Canonical URL = lowercase host, strip fragment and `utm_*`/`ref` params, drop trailing slash —
one pure function in `kk-store` with its own failure-first test list.

### Config

`~/.config/kk/config.yaml` gains `store.db_path` (optional). Resolution: `store.db_path` →
`<works_dir>/kk.db`. Relative paths resolve against the config file's project root, same as
`works_dir`. Read through the existing kk config loader — no second loader.

### Boundary rules (I7)

`.spur/rules/boundary/kk-store-boundary.yaml`, copied from spur's `dao-boundary.yaml`:
`ts-db-only-in-kk-store` (forbid `@gobing-ai/ts-db` outside `packages/kk-store/**`) and
`drizzle-only-in-kk-store-schema` (forbid `drizzle-orm*` outside `packages/kk-store/src/schema/**`
and `drizzle/`). Both run in `bun run gate` via `spur rule run`.

## 3. `kk store` verbs (apps/cli, one commander noun)

| Verb | Does | Exit |
| --- | --- | --- |
| `kk store migrate` | apply pending migrations | 0 / 1 |
| `kk store lock acquire\|release --name collect --run <id> [--ttl 7200000]` | single-flight; held lock ⇒ prints `{"skipped":"locked"}`, exit 0 + writes `.skip` marker | 0 |
| `kk store ingest --run <id> --in <docs.json>` | upsert `Doc[]`, record `collect_runs`, print `{inserted, updated, unchanged}`, write `new-ids.json` | 0 / 1 |
| `kk store label --run <id> --catalog <dir> [--maker fm-local]` | label items in `new-ids.json` (+ invalidated); catalog loads checked with `spur decision status --json` (`ok`, empty `loadErrors`) — there is no `decision validate` verb | 0 (degraded ⇒ heuristic, `source: default`) |
| `kk store extract --topic <name> --window 24h --limit N --out <docs.json> [--exclude-used <workflow>]` | profile query → `Doc[]` (labels inlined into `metadata`) | 0 (empty pool ⇒ `[]` + `pool-empty` marker) |
| `kk store mark-used --workflow <w> --run <id> --in <plan.json>` | write `episode_usage` | 0 / 1 |

## 4. Labels via `spur decision` (I8–I10, I20)

Catalog at `plugins/kk/decisions/` (kk-owned, added to `decisions.paths` in `.spur/config`):

| Decision id | Type | Labels / rubric | Fallback |
| --- | --- | --- | --- |
| `kk-item-category` | choice | `ai-news` `ai-technical` `ai-research` `ai-industry` `non-ai` (MECE v1, from episode-plan-gen) | `non-ai` |
| `kk-item-quality` | score | 0–5 rubric | 2 |
| `kk-item-importance` | score | 0–5 | 2 |
| `kk-item-urgency` | score | 0–5 | 2 |
| `kk-item-impact` | score | 0–5 | 2 |

**Cost control.** `kk store label` first runs the existing episode-plan-gen keyword heuristic
(extracted to a pure function the plugin and `kk store label` both import). Only items the
heuristic cannot classify confidently, or all new items when `label.mode: decision`, go to
`spur decision run <id> --param title=… --evidence <tmp body file> --maker <maker> --json`.
Labels are never re-run on unchanged items. A decision returning `source: default` (backend
degraded) records the heuristic value with `source: default` — the run never fails on labels.

**Extraction is data, not code.** Topic profiles live in
`plugins/kk/decisions/extract/<topic>.yaml`:

```yaml
topic: ai-news
where:
  kk-item-category: { in: [ai-news, ai-industry] }
  # quality gate is gte 2 (task 0212): the heuristic labeler tops out at 1-2 and a gte-3 gate
  # emptied every real pool
  kk-item-quality: { gte: 2 }
  kk-item-importance: { gte: 3 }
order: [kk-item-urgency desc, kk-item-impact desc, first_seen_at desc]
```

`kk store extract` compiles the profile into one SQL query over `labels` (DAO method, no raw SQL
outside kk-store). A new topic = a new profile file (R11). A topic-specific *decision* can be
added later as an extra catalog entry without schema change (labels are row-per-decision).

### Confidence surfaces (G31 R14, task 0213)

Every G31 surface that emits or consumes a pass-like label outcome, and whether it carries the
closed `HIGH|MEDIUM|LOW` level. `apps/cli/tests/store-docs.test.ts` resolves each citation.

| Surface | Role | Anchor | Carries |
| --- | --- | --- | --- |
| Row level derivation | emit | `packages/kk-store/src/dao/labels.ts:39` | yes — model 0–1 mapped; heuristic/default is `LOW` |
| `kk store label` row write | emit | `apps/cli/src/commands/store.ts:586` | yes |
| `labels.confidence` column | persist | `packages/kk-store/src/schema/labels.ts:28` | yes (migration `0002`) |
| Label DAO upsert / read | persist | `packages/kk-store/src/dao/labels.ts:103` | yes |
| Pass level (weakest row) | emit | `packages/kk-store/src/dao/labels.ts:50` | yes |
| `kk store label` verdict line | emit | `apps/cli/src/commands/store.ts:705` | yes — `{verdict, confidence, …}` |
| `kk-collect` `label → release` guard | consume | `plugins/kk/workflows/kk-collect.yaml:236` | yes — absent/out-of-enum refused by name |
| `kk store extract` | consume | `apps/cli/src/commands/store.ts:817` | named gap — selects by label value, not a verdict consumer |
| `kk-daily-ai-voice2` judge/safety gates | consume | — | named gap — workflow not built (G11/G71) |

## 5. `kk-collect.yaml` (state-machine — simple sequence, failure edges explicit)

| State | Action | On failure |
| --- | --- | --- |
| `lock` | `kk ledger sync` + `kk stage collect-prepare <stamp> <limit> <topic> <hours>` (work dir + JSON-safe ingest params) + `kk store migrate && kk store lock acquire --name collect --run $__runId` | `failed`; skipped ⇒ `done-skipped` |
| `collect` | `kk executor fan-in --source aihot-ingest --source last30days-ingest --source horizon-ingest --out <run>/docs.json` + core-facts markdown render (existing `daily-collect-facts` logic moved into the `core-facts-gen` plugin) | `release` → `failed` |
| `store` | `kk store ingest --run $__runId --in <run>/docs.json` | `release` → `failed` |
| `label` | `kk store label --run $__runId --catalog plugins/kk/decisions` | (never fails, see §4) |
| `release` | `kk store lock release …` + `kk ledger append --workflow kk-collect --run $__runId` | `done` |

Run dir: `.works/kk-collect/<YYYYMMDD-HHmm>/` (docs.json, core-facts.md, label-report.json).

**Schedule (I2).** Spur has no scheduler. kk ships `plugins/kk/schedules/launchd.plist.tmpl`
and `cron.tmpl` (`0 4,10,16,22 * * *`), rendered by `kk schedule render kk-collect
--platform launchd|cron` to stdout. Installing (`launchctl bootstrap` / `crontab`) is an operator
action documented in the satellite; kk never edits the operator's crontab.

## 6. `kk-daily-ai-voice2.yaml` (kind: dag)

### Engine constraints (verified, `src/dag.ts`)

- One `action` per node; no back-edges; `dependsOn` + `dependencyPolicy: all|any`.
- **Wave scheduler**: each loop dispatches all ready nodes with `Promise.all` and waits for the
  whole wave. A fast branch's successor waits for the slowest sibling in its wave. Ceiling
  accepted (`ponytail:` true critical-path scheduling is an engine change, not kk's).
- **Fail-fast**: any failed node fails the run. Non-blocking channels (xhs, wechat, locales)
  therefore keep today's contract — their kk stages exit 0 on soft failure and record status.
- `condition` (guard kind, e.g. `shell`) false ⇒ node and dependents skipped.
- `pause: true` pauses before the node; resume runs it (operator review).
- `setVars` merge across concurrent nodes is last-writer-wins ⇒ **nodes pass data by files at
  fixed paths under `work_dir`, never by vars.** The one exception: `prepare` → `read-work-dir`
  (`file.read.into-var`) run as single-node waves before any fan-out, so projecting `work_dir` /
  `run_date` into vars cannot race. No `setVars` after the first fan-out.
- No sub-workflow action ⇒ the safety loop is a shell node running
  `spur workflow run plugins/kk/workflows/kk-daily-safety.yaml --vars …` synchronously; that
  state-machine owns review → judge → revise (bound `safety_max_revise`) and exits non-zero only
  on `block`/integrity failure.

### Node map (multi-action states become node chains)

```
prepare ─► extract ─► plan ─► qc-content ─┬─► plan-translate(agent)
                                          ├─► article-write(agent) ─► article ─────────────┐
                                          ├─► cover-brief(agent) ─► cover ─────────────────┤
                                          └─► script-style ─► script-write(agent) ─► script┤
                                                                                           ▼
                                                              safety (sub-workflow) ─► review (pause)
                                                                                           │
                       ┌───────────────────────────┬──────────────────────────┬────────────┤
                       ▼                           ▼                          ▼            ▼
             generate(TTS) ─► intro ─► duration  wrap-docs ─► publish-prep   xhs-write(agent)  
                       └─────────► quality ◄──────┘        │                  └► xhs-render ─► xhs-publish
                                     │                     ├► publish-surfdash ─► translate-localize ─► translate(agent) ─► translate-sync
                                     ▼                     └► wechat-publish
                         show-notes ─► publish-podcast
                                     ▼
              publish-classify (deps: podcast, surfdash, xhs-publish, wechat, translate-sync; policy all)
                                     ▼
                       mark-used ─► run-report ─► ledger
```

- `extract` = `kk store extract --topic ai-news --window ${vars.window} --exclude-used kk-daily-ai-voice2 --out ${work_dir}/10-collect/pool.json`; `condition` on every downstream root: pool non-empty. Empty ⇒ all skipped. Engine skip rule (`dag.ts:126`): a node whose deps are **all** skipped is skipped; done+skipped mix proceeds. So `run-report` and `ledger` list `extract` in `dependsOn` next to their normal deps — they still run on an empty pool and record `no-content` (G11 R3).
- `plan` consumes `pool.json` through the existing episode-plan-gen plugin; labels in `metadata` replace its keyword re-scoring when present.
- `publish_enabled=false` ⇒ `condition` skips the publish subtree (same var as today).
- `patch-surfdash` / `publish-partial` fold into `publish-classify` (it already classifies partial).

### Boundary rule (I14)

Each node is one `kk …` command, one `agent.run`, or one `spur workflow run` (`runActionStep` in
`dag.ts:219` accepts any registered action kind, so `agent.run` / `file.read.into-var` nodes are legal). No `bun -e`, no
inline jq/path arithmetic. Stage logic used by voice2/collect moves out of
`plugins/kk/scripts/kk-workflow-stages.ts` into the owning plugin or a `kk` subcommand **when
touched**; untouched voice-only stages stay until cut-over (no drive-by refactor). Agent nodes
receive only file paths from fixed layout + vars.

## 7. Ledger (I15–I16)

The first node of every run (`prepare` / `lock`) runs `kk ledger sync --workflow <name>`, which
appends every finished run id missing from the ledger (failed ones included) from `spur workflow
trace --workflow <name> --json` (`.entries[].runId`). That is how a run gets its section: the
final-node `kk ledger append --run <run-id>` sees its own run still `running` and exits 1 (swallowed
by `onError: continue`), and a fail-fast DAG never reaches it. Idempotent by run id.

Source: `spur workflow trace <run-id> --json` → `{ run: { runId, workflowName, status, startedAt,
completedAt, durationMs, outcome }, events: [...] }`. Rows come from `events[]` with
`kind: "action"` (`node`, `actionKind`, `status`, `durationMs`, `ok`, `error`, `cost`), grouped by
`node` (a state's several actions sum into one step row). Verified on run `f2d6921f`. Output appended to `.works/<workflow>/ledger.md`:

```markdown
## 2026-10-07T13:00Z · run 3f2a… · done · 41m12s · tokens: 182k (+3 unknown)

| Step | Status | Duration | Tokens in/out | Result |
| --- | --- | --- | --- | --- |
| extract | done | 0.4s | — | 38 items |
| article-write | done | 6m02s | unknown | 24-script/…_article.md |
```

Tokens: non-agent nodes `—`. Agent nodes read `cost.exact.totals.{inputTokens,outputTokens}`
(spur's session-import totals; present even when the executor's own `usage.availability` is
`unavailable`, e.g. `plan-translate` on `f2d6921f`: 6.70M in / 59k out). When `cost.exact` is null
— including when only `cost.estimated` exists — the cell is `unknown` and the header counts it.
Never estimated. `Result` = the step's one-line
summary file (`<step>.summary.txt`) when the kk command writes one, else exit status; `sync` reads
summaries for the newest missing run only (no per-run work dir in the trace).

## 8. Rollout and cut-over (I22)

| Phase | Ships | Gate |
| --- | --- | --- |
| P1 | kk-store + migrations + boundary rules + config | `bun run gate`, rule run |
| P2 | kk-collect + `kk store ingest/label` + decision catalog + schedule templates + ledger | 2 real 4h runs, ledger rows |
| P3 | `kk store extract/mark-used` + profiles | extract over P2 data |
| P4 | voice2 DAG + safety sub-workflow + stage moves | dry-run publish E2E (R22) |
| P5 | parity | `kk ledger cutover-check --candidate kk-daily-ai-voice2 --baseline kk-daily-ai-voice --runs 5` |

Retiring `kk-daily-ai-voice.yaml` is a separate follow-up change after P5 reports ready.

## 9. Deferred

Backfill of `.works/kk-daily-ai-voice/<date>/` JSON (I23); retention/pruning (I24); in-tool
scheduler; engine critical-path scheduling.
