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
                               items · collect_runs · labels · selections
```

`kk-daily-ai-voice.yaml` stays untouched until cut-over (§8).

## 2. `@gobing-ai/kk-store` (new workspace `packages/kk-store`)

| Piece | Path | Mirrors spur |
| --- | --- | --- |
| Adapter + migrate | `src/db.ts` — `openStore({ path })`: `createDbAdapter({ driver: 'bun-sqlite', url })`, `PRAGMA journal_mode = WAL` + `PRAGMA busy_timeout = 30000` via `adapter.exec` (the typed pragmas option omits busy_timeout — spur `db.ts:38`), then `applyKkMigrations` | `packages/domain/src/db.ts` |
| Schema | `src/schema/*.ts` — tables via `defineTable(name, cols)` + column builders from `@gobing-ai/ts-db/schema` (spur `schema/runs.ts`); zero direct `drizzle-orm` imports | `packages/domain/src/schema/` |
| DAOs | `src/dao/{items,collect-runs,labels,selections,locks}.ts` extending ts-db `EntityDao` | `packages/domain/src/dao/` |
| Migrations | embedded `KkMigration[]` (`{id, sql}`) journaled in `__kk_store_migrations`; `0001_kk_store_init` is a frozen literal (a builder-derived DDL cannot converge a fresh database with `0003`'s `labels` rebuild), `0002_labels_confidence_run_id` adds `confidence`/`run_id`, and `0003_store_v2` is `atomic` — the journal row plus every statement in one transaction | spur `packages/domain/src/migrations.ts:1625` `applyCliMigrations` |
| Public API | `src/index.ts` — DAOs + `openStore` + row types; no ts-db types leak | — |

`@gobing-ai/ts-db` is already in the root catalog (`^0.5.15`); `kk-store` consumes it via
`catalog:` — no new third-party dependency.

### Tables (v2 — after `0003_store_v2`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `items` | `id` (sha256 of canonical URL, or of body when URL-less), `canonical_url` UNIQUE NULL, `content_hash`, `title`, `body`, `source`, `media_type`, `metadata_json`, `first_seen_run`, `last_seen_run`, `first_seen_at`, `published_at`, typed facts `engagement`, `body_chars`, `source_tier`, `lang`, `domain`, `story_id` (`items_story_idx`) | Upsert on `id`; `content_hash` change ⇒ `labels` for that item are invalidated (re-label next run). The facts are deterministic, derived from the Doc (0227); `story_id` is the title-clustering dedup key `kk store backfill-facts` recomputes |
| `collect_runs` | `run_id` PK, `started_at`, `finished_at`, `status`, `source_counts_json`, `inserted`, `updated` | provenance |
| `labels` | identity (`item_id`, `decision_id`, `maker`, `run_id`) UNIQUE (`labels_observation_unique`), `value`, `score` NULL, `confidence` (`HIGH`\|`MEDIUM`\|`LOW`\|NULL), `source` (`model`\|`heuristic`\|`default`), `labeled_at`, raw evidence `raw_value`, `raw_confidence`, `reason`, `duration_ms`, `catalog_version`, `content_hash` | one row per (decision, maker, run) observation (0225/0226). `content_hash` binds the row to the item revision it judged, so a re-ingest invalidates it |
| `selections` | (`topic`, `item_id`, `run_id`) PK, `story_id`, `workflow`, `rank`, `reason`, `status` (`selected`\|`published`\|`dropped`), `selected_at`, `published_at` | topic-scoped cross-day dedup (I18; replaced `episode_usage` in 0225, written by 0228) |
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
| `kk store label --run <id> --new-ids <path> [--maker <name>]` | label items in `new-ids.json` (+ invalidated); the maker defaults to `.spur/config.yaml` `decisions.maker`; catalog loads checked with `spur decision status --json` (`ok`, empty `loadErrors`) — there is no `decision validate` verb | 0 (degraded ⇒ heuristic, `source: default`) |
| `kk store extract --topic <name> --window 24h --limit N --include-selected --out <docs.json>` | profile query → `Doc[]` (labels inlined into `metadata`), minus the topic's already-selected/published stories | 0 (empty pool ⇒ `[]` + `pool-empty` marker) |
| `kk store select --topic <t> --workflow <w> --run <id> --in <candidates.json>` | write `selections` rows, `status: selected` | 0 / 1 |
| `kk store mark-published --topic <t> --run <id> [--in <ids.json>]` | promote the run's `selected` rows to `published` | 0 / 1 (0 rows ⇒ `{published: 0}`) |
| `kk store release --run <id> [--topic <t>]` | move the run's `selected` rows to `dropped`, returning its items to the pool | 0 / 1 |
| `kk store backfill-facts [--db <path>]` | recompute typed item facts and causal `story_id` clustering for every item (idempotent), print `{updated}` | 0 / 1 |
| `kk store pool-count <file> --min <n>` | guard predicate: exit 0 when pool holds ≥ n items, print `{count, min}` | 0 / 1 |

## 4. Labels via `spur decision` (I8–I10, I20)

Catalog at `plugins/kk/decisions/` (kk-owned, added to `decisions.paths` in `.spur/config`):

| Decision id | Type | Labels / rubric | Fallback |
| --- | --- | --- | --- |
| `kk-item-category` | choice | `ai-news` `ai-technical` `ai-research` `ai-industry` `non-ai` (MECE v1, from episode-plan-gen) | `non-ai` |
| `kk-item-quality` | score | 0–5 rubric | 2 |
| `kk-item-importance` | score | 0–5 | 2 |
| `kk-item-urgency` | score | 0–5 | 2 |
| `kk-item-impact` | score | 0–5 | 2 |
| `kk-item-china-politics` | score | 0–3 — 0 no reference to the political system/institutions/top leader (Chinese companies, models and products are 0) · 1 a factual government-body/policy mention as news context · 2 commentary on the system/institutions · 3 the top leader's personal information or a direct critique | 3 |
| `kk-item-sensitivity` | score | 0–3 — none / mild / notable / high publish risk (unverified claims, legal exposure, political sensitivity) | 1 |
| `kk-item-audience` | choice | `general` `practitioner` `researcher` | `general` |

The three task-0229 decisions are the **judgment** decisions: the plugin's keyword heuristic has no
signal for them, so `kk store label` consults them for EVERY labelled item in both modes (the
heuristic's five keep their heuristic-first routing), and their consults count in
`consults`/`consultMs`. `kk-item-china-politics` exists to avoid unnecessary platform-moderation
rejection (D3a) and must NOT exclude China-related content: Chinese companies, models, products,
industry and ordinary regulation news score 0. Its `description` states that rule, and its prefilter
terms are top-leader/central-institution only.

The **china-politics keyword prefilter** scans the title plus the body head (first 200 characters),
case-insensitively, against `store.labels.china_politics_terms` (default: `习近平`, `总书记`,
`中共中央`, `政治局`, `中南海`, `党中央`, `Xi Jinping`, `Politburo`, `Zhongnanhai`). On a hit it writes
a maker `keyword`, source `heuristic`, value `3` observation with reason `keyword:<term>` — never
maker `heuristic` — and the model is STILL consulted, so a backtest keeps both rows. A hit is a hard
floor because `store.labels.decisions.kk-item-china-politics.priority` defaults to
`['keyword', '*', 'heuristic']`.

**Raw observations and the current-label view.** Every consult writes an observation row, never an
overwrite: the identity is (`item_id`, `decision_id`, `maker`, `run_id`), so two makers' answers to
the same decision — or two runs of the same maker — sit side by side and the pool can later be
re-labeled and compared (0226). A row carries the decision's normalized `value`/`score`/`confidence`
**and** the raw evidence the maker returned — `raw_value`, `raw_confidence`, `reason`,
`duration_ms` — plus `catalog_version` (the decision catalog's `version`) and the item's
`content_hash` at judgment time, so evidence is never lost and a row is invalidated when the item's
body changes. `kk store label --replay since:24h --maker <m>` re-runs the labeler against a
historical pool and writes the new rows under a `replay-*` run id, so a backtest never displaces
production selection.

Consumers never read `labels` directly. `labelsCurrentSql(policy)`
(`packages/kk-store/src/dao/labels.ts`) defines the `labels_current` CTE — for every
(`item_id`, `decision_id`) the one eligible, highest-priority observation. A row is eligible when its
`content_hash` matches the item's current hash, its `source` is not `'default'` (a degraded row is
not a label), a `source 'model'` row clears `store.labels.min_confidence` (default `0.8` — a
migrated v1 model row with NULL `raw_confidence` and a new model row with NULL `raw_confidence` are
both non-current, while a migrated heuristic row remains current), its maker
is listed in the effective priority, and a `replay-` run id may win only for a maker named **by name**
(never `'*'`). `store.labels.priority` (default `['*', 'heuristic']`) sets that order per decision —
a maker not listed is filtered out in `WHERE`, never ranked last. `kk store extract`'s profile joins
and the inlined `metadata.labels` both go through this one CTE, so a `where` decision is an INNER
join on the current label: an item with no current answer is excluded (fail-closed).

**Cost control.** `kk store label` first runs the existing episode-plan-gen keyword heuristic
(extracted to a pure function the plugin and `kk store label` both import). Only items the
heuristic cannot classify confidently, or all new items when `label.mode: decision`, go to
`spur decision run <id> --param title=… --evidence <tmp body file> --maker <maker> --json`; each
new item therefore costs three EXTRA consults for the judgment decisions. Labels are never re-run
on unchanged items. A decision returning `source: default` (backend degraded) records the heuristic
value with `source: default` — the run never fails on labels.

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
  # 0229 R5 (conservative moderation gate): a `where` key is an INNER join on labels_current, so an
  # item with no current china-politics answer is EXCLUDED (fail-closed). 0-1 clears the gate.
  kk-item-china-politics: { lte: 1 }
order: [kk-item-urgency desc, kk-item-impact desc, first_seen_at desc]
```

`kk store extract` compiles the profile into one SQL query over `labels` (DAO method, no raw SQL
outside kk-store). A new topic = a new profile file (R11). A topic-specific *decision* can be
added later as an extra catalog entry without schema change (labels are row-per-decision) — 0229's
three judgment decisions are exactly that, and `packages/kk-store/src/profile.ts` `ITEM_DECISION_IDS`
lists them so a profile may name them.

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
| `release` | `kk store lock release …` (the run's ledger section is written by the next tick's `lock` → `kk ledger sync`, §7) | `done` |

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
prepare ─► extract ─► plan ─► qc-content ─┬─► select ────────────────────────────────────────┐
                                          ├─► plan-translate(agent) ─► plan-translate-retry(agent)
                                          ├─► article-write(agent) ─► article-write-retry(agent) ─► article ─┐
                                          ├─► cover-brief(agent) ─► cover ───────────────────────────────────┤
                                          └─► script-style ─► script-write(agent) ─► script ──────────────────┤
                                                                                                             ▼
                                                              safety (sub-workflow) ─► review (pause)
                                                                                           │
                       ┌───────────────────────────┬──────────────────────────┬────────────┤
                       ▼                           ▼                          ▼            ▼
             generate(TTS) ─► intro ─► duration ─► publish-prep            xhs-write(agent)  
                       └─────────► quality ◄──────┘        │                  └► xhs-render ─► xhs-publish ◄─ publish-prep (0236)
                                     │                     ├► publish-surfdash ─► translate-localize ─► translate(agent) ─► translate-sync
                                     ▼                     └► wechat-publish
                         show-notes ─► publish-podcast
                                     ▼
              publish-classify (deps: podcast, surfdash, xhs-publish, wechat, translate-sync; policy all)
                                     ▼
                  mark-published ─► run-report ─► ledger
```

- `extract` = `kk store extract --topic ai-news --window ${vars.window} --out ${work_dir}/10-collect/pool.json` (the ai-news exclusion is always on — 0228 R4); `condition` on every downstream root: pool non-empty. Empty ⇒ all skipped. Engine skip rule (`dag.ts:126`): a node whose deps are **all** skipped is skipped; done+skipped mix proceeds. So `run-report` and `ledger` list `extract` in `dependsOn` next to their normal deps — they still run on an empty pool and record `no-content` (G11 R3).
- `20-facts/` stays empty. `kk daily prepare` still creates the voice1 directory set, including `20-facts`, but this DAG never writes core facts. The pool file `10-collect/pool.json` replaced voice1's `20-facts/<stamp>_02_collect_core-facts.md`. An empty directory is the port, not a skipped stage.
- `plan` consumes `pool.json` through the existing episode-plan-gen plugin; labels in `metadata` replace its keyword re-scoring when present. The voice2 node passes `plan_translate_enabled` as `daily-plan`'s 5th argument. When that argument is `true`, the stage caches on `_03_plan_content.json` and does not write `_03_plan_plan.json`, so `plan-translate`'s `! test -s` guard actually runs on the first pass. Voice1 stays a four-argument call and still writes the plan file. `daily-qc-content` drops near-duplicate titles from the candidates (the same `dedupPlanByTitle` pass `daily-article` repeats) before `select` and the authoring agents, including on a candidates cache hit, so a later article dedup cannot invalidate an already-written script plan. `daily-script` accepts optional `episode_max_minutes` and `vdriver` after the voice profile; when the spoken character estimate exceeds the ceiling minus two minutes it shortens the longest fact segments at `。`/`！`/`？`, then insights, and rewrites the VoiceScript as block YAML (the dailynews-gen shape) before the cache is sealed. The two-minute headroom is there because the character rate is a past measurement: a script fitted flush to the ceiling can fail `daily-episode-duration` after TTS. A `{...}` flow document is rejected — the VoiceScript checker JSON-parses any file that starts with `{`. Under-budget scripts are left byte-for-byte. `daily-show-notes` drops ids named in the article's 未写入 note and ids listed in the script plan's `excluded` array, so show notes match the spoken set when the keyword floor left a public-affairs item in the plan.
- `publish_enabled=false` ⇒ `condition` skips the publish subtree (same var as today).
- `xhs-render` / `xhs-publish` are voice2-only steps: `xhs-render` passes the 9th arg `note_scope: episode` (0235 — the packaged note carries the episode cover last plus one numbered body line per attached image) and `xhs-publish` the 5th `podcast: true` (0236 — the episode's 发播客 note rides the same console visit as `metadata.followUps`, one ADR-025 cap entry). Both nodes carry their own `xhs_enabled` gate (a skipped `xhs-write` still admits its dependents, so without it a run with `xhs_enabled=false` would re-package and re-publish a stale same-day `25-xhs/` series). For the 发播客 note, `xhs-publish` also depends on `publish-prep`, a **data** dependency (it reads `_13_publish-prep_content.json`): without that edge the two nodes race and the 发播客 note is dropped silently while the stage still exits 0 — the DAG review finding fixed in 0236. voice1 (`kk-daily-ai-voice.yaml`) calls both stages with neither argument and is byte-identical; its spec stays in `kk-daily-ai-voice.md` §7, the surfaces in `docs/04_DESIGN.md`.
- `patch-surfdash` / `publish-partial` fold into `publish-classify` (it already classifies partial).
- `plan-translate` / `article-write` are the two **hard-fail** `agent.run` producers (a missing `expectFile` fails the run). 0238: the resolved executor is stochastic — a run has been observed answering a greeting with zero tool calls and exiting 0 — and the engine has no node retry, so each carries a `-retry` sibling with the **same `input`/`expectFile`** on a different tier (`agent_retry`, `role: reviewer` — capable-1, two rungs above the primary's `scribe`, because a cheap primary climbs to standard when its rung is unusable and a `coder` retry then resolved to the same executor). The primary becomes `onError: continue`; the sibling's guard is `! test -s <expectFile>` and it carries **no** `onError`, so a second miss still fails the run loudly. Every reader of `21-plan/<date>_03_plan_plan.json` (`article-write`, `cover-brief`, `script-write`) and the `article` node depends on **both** the primary and its sibling — the engine's done+skipped mix then keeps a successful primary's retry skipped without stranding the dependents. Delete the siblings when spur grows an `agent.run` retry.

- **Verifying this DAG (internal runs).** Two rules, both learned live on 2026-10-09:
  - **Pin `kk` on `PATH`.** A workflow shell node resolves `kk` from `PATH`, so when the global
    (bun-linked) `kk` wins, `kk stage …` silently executes **another checkout's**
    `plugins/kk/scripts/*.ts`. An AC5 attempt spent 40 minutes running the pre-0237 one-shot
    `dailyGenerate` — the run never failed, it simply validated the wrong code. Put this checkout's
    own `kk` shim **first** *and* drop `~/.bun/bin` from `PATH` (so no other `kk` can win even if a
    child rebuilds `PATH`), invoke `spur` by absolute path, and keep the shim's invocation log as the
    audit trail that proves which code ran.
  - **Use `vdriver=voicebox` for internal testing** (operator rule, 2026-10-09) so a verification run
    never spends the Gemini TTS daily quota (Tier 1, 100 requests/day). The local driver renders at
    roughly 10× real time — a full episode is hours — so run it detached and let the section
    cache absorb the cost. Switching drivers is safe: the driver id is part of the section cache key,
    so no mixed-voice episode is possible.
  - Resuming is cheap **only** while the VoiceScript text is stable: every authoring agent is guarded
    by its own output (`plan-translate`, `article-write`, `script-write`, `cover-brief`), because
    re-authoring rewrites the script and invalidates every cached section.
- `select` = `kk store select --topic ai-news --workflow kk-daily-ai-voice2 --run ${vars.__runId} --in ${work_dir}/21-plan/<date>_04_quality-control-content_candidates.json`, declared right after `qc-content`, guarded on the candidates file. It reads the QC output, not `03_plan_plan.json`: the plan file is pre-QC, so selecting it would burn items the run rejected. This is 0228's fix for the root cause F4: the exclusion is recorded the moment the run commits to its set, not at the DAG tail, so a run that fails, pauses at review or skips publish still excludes what it planned.
- `mark-published` = `kk store mark-published --topic ai-news --run ${vars.__runId}` on `dependsOn: [publish-classify, extract]`, with the candidates guard **and** `test "${vars.publish_enabled}" = "true"` — a dry run never promotes, so its rows stay `selected` (still excluding, freed by `kk store release --run <id>`). `run-report` lists it in `dependsOn`.
- `kk daily prepare --workflow <w>` writes one stderr line per other run still holding `selected` rows for the workflow, each naming the `kk store release --run <id>` that frees it (0228 R7).

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
trace --workflow <name> --json` (`.entries[].runId`). That is how a run gets its section: an
in-run final-node `kk ledger append --run <run-id>` sees its own run still `running` and exits 1
with "nothing was written", so `kk-collect` does not carry that action at all — carrying it cost a
failed step on every green run (`release | failed` in all 7 runs through 2026-10-09) and told the
operator the healthy ledger was broken. A fail-fast DAG never reaches its append node either. Sync is
the only writer, and an operator can still append a finished run by hand. Idempotent by run id.

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
| P3 | `kk store extract` + profiles, `select`/`mark-published`/`release` | extract over P2 data |
| P4 | voice2 DAG + safety sub-workflow + stage moves | dry-run publish E2E (R22) |
| P5 | parity | `kk ledger cutover-check --candidate kk-daily-ai-voice2 --baseline kk-daily-ai-voice --runs 5` |

**G32 cut-over (0225–0230, 2026-10-09).** Store v2 ships as one schema cut-over:
`0003_store_v2` rebuilds `labels` onto the four-column observation identity with the raw-evidence
columns, adds the typed `items` facts, and replaces `episode_usage` with `selections`. The live store
migrated outside this task (recorded in 0241), the settled state and recovery paths are owned by
task 0242 (R5), and v1 rollback is not supported once a v2 binary has written to the store. Every
`episode_usage` row becomes a `selections` row with topic `ai-news` and `status 'published'`, so the
"never re-aired" invariant survives the table swap.

Retiring `kk-daily-ai-voice.yaml` is a separate follow-up change after P5 reports ready.

## 9. Deferred

Backfill of `.works/kk-daily-ai-voice/<date>/` JSON (I23); retention/pruning (I24); in-tool
scheduler; engine critical-path scheduling.
