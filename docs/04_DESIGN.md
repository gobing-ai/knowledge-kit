---
name: Design
doc: 04_DESIGN
owns: "SURFACE — concrete shapes: every CLI command, flag, config key, env var, table, DTO"
authority: derived
version: 2.50.0
created_at: 2026-07-22
updated_at: 2026-10-15
derived_from: [00_ADR, 01_PRD, 03_ARCHITECTURE]
edit_rules: 99 §6.5
sync: [T3]
---

# Design — surface shapes

> Derived. Concrete shapes — every command, flag, config key, env var, schema, and DTO.
> Edit in the **same commit** as the surface change (constitution T3).

## 0. Design satellites

| Satellite | Area | Status |
| ----------- | ------ | -------- |
| [kk-itc-refactor.md](design/kk-itc-refactor.md) | DAG/child authoring, config/workspaces, publication presets, recovery and SEO handoffs | shipped (G21, ADR-040; tasks 0298–0303) |
| [kk-smart-seo.md](design/kk-smart-seo.md) | SEO/GEO audit workflow, decision catalogs, stages and one skill | accepted design; not implemented (G9, ADR-039) |
| [kk-noun-verb-bots.md](design/kk-noun-verb-bots.md) | Strict noun/verb operations + named browser sessions | accepted design; not implemented (A22, ADR-037/038) |
| [kk-cli-surface.md](design/kk-cli-surface.md) | Operator `kk` binary + two-noun tree | shipped (A2/A21) |
| [kk-plugin-check.md](design/kk-plugin-check.md) | `kk plugin check` / `login` live readiness probe (ADR-032) | shipped verbs + all fourteen channels (E93, 0215+0216; E94 adds `weibo-pub`, 0291 adds `jike-pub`, 0292 adds `csdn-pub`, 0293 adds `cnblogs-pub`, 0294 adds `sspai-pub`, 0295 adds `xiaoyuzhou-pub`, 0296 adds `shipinhao-pub`, 0297 adds `bilibili-pub`) |
| [fan-in-and-fan-out-specification.md](design/fan-in-and-fan-out-specification.md) | `executor fan-in` merge and concurrent `executor fan-out` | shipped (B6) |
| [ingestion-plugin-specification.md](design/ingestion-plugin-specification.md) | Ingestion kind contract | shipped (C1) |
| [generator-plugin-specification.md](design/generator-plugin-specification.md) | Generator kind contract | shipped (D3) |
| [publish-plugin-specification.md](design/publish-plugin-specification.md) | Publish kind + transports | shipped (E2) |
| [emdash-pub.md](design/emdash-pub.md) | EmDash CMS publish channel | shipped (E5) |
| [multi-root-plugin-discovery.md](design/multi-root-plugin-discovery.md) | Built-in + user plugin discovery merge | shipped (B7, ADR-012) |
| [storm-evidence-cache.md](design/storm-evidence-cache.md) | STORM per-reference cache, markitdown normalization, digest contract | shipped (C5, ADR-013) |
| [ts-libs-logging-foundation.md](design/ts-libs-logging-foundation.md) | Catalog, output, diagnostics, and enforcement shapes | shipped (A3, ADR-014/ADR-015) |
| [itc-generating.md](design/itc-generating.md) | ITC generating skill — method + orchestration, no CLI | shipped (F3) |
| [voice-gen.md](design/voice-gen.md) | Voice generator plugin over local Voicebox REST | shipped (D5) |
| [kk-solo-podcast.md](design/kk-solo-podcast.md) | Solo-podcast product workflow over voice-gen | shipped (F5) |
| [aihot-ingest.md](design/aihot-ingest.md) | Ingestion plugin for aihot.virxact.com AI news | shipped (F6) |
| [dailynews-gen.md](design/dailynews-gen.md) | Generator plugin for daily news VoiceScript Content | shipped (F6) |
| [episode-plan-gen.md](design/episode-plan-gen.md) | Episode plan generator: score, dedup, select, translate flag — single upstream for article/script/show notes | shipped (F61, 2026-09-05) |
| [kk-daily-ai-voice.md](design/kk-daily-ai-voice.md) | Daily AI news voice broadcast workflow | shipped (F6) |
| [podcast-pub.md](design/podcast-pub.md) | microfeed podcast publish channel + instance deploy; Apple enclosure MIME gate and channel compliance checklist | shipped (E6; 0170/0173) |
| [remaining-wt-publish-harvest.md](design/remaining-wt-publish-harvest.md) | Leftover wt publish channels + browser drivers on the harness | shipped (E7) |
| [browser-publish-channels.md](design/browser-publish-channels.md) | InfoQ/Juejin/Substack/X-article script flows on ts-browser-automation + `publish-harness/browser` command library; per-channel transport verdict | shipped (E91, ADR-027; 0183–0188) |
| [weibo-threads-publish-channels.md](design/weibo-threads-publish-channels.md) | Weibo (script browser: post + 头条文章 draft) and Threads (official text API) publish channels on the x-pub split | implemented (E94); Threads API live-verified offline-only, Weibo post selectors pinned live 2026-10-12 and the 头条文章 half is entitlement-gated — live post/article evidence still open (0246, `docs/design/weibo-ui-discovery.md`) |
| [kk-daily-ai-voice-gap-analysis.md](design/kk-daily-ai-voice-gap-analysis.md) | Gap analysis vs ideal end-to-end daily pipeline | research (F61) |
| [ingestion-source-adapters.md](design/ingestion-source-adapters.md) | last30days + Horizon ingestion adapter briefs (Doc[] mapping) | research (F61) |
| [core-facts-template.md](design/core-facts-template.md) | Core-facts markdown template & blend contract prototype | prototype (F61) |
| [article-publish-fanout-brief.md](design/article-publish-fanout-brief.md) | Article generator home, podcast show notes, and fan-out shape brief | research (F61) |
| [omni-voice-gen.md](design/omni-voice-gen.md) | OmniVoice-backed (PyPI) Python voice generator plugin, drop-in for voice-gen | shipped (F611) |
| [kk-itc-end-to-end.md](design/kk-itc-end-to-end.md) | kk-itc idea → research → judge-gated draft → per-platform drafts (HITL + auto) | shipped (F41) |
| [gemini-tts.md](design/gemini-tts.md) | Gemini 3.8 TTS voice generator: hosted backend adapter over voice-gen, drop-in via `vdriver: gemini` | shipped (F612) |
| [xhs-image-cards.md](design/xhs-image-cards.md) | XHS card skill, image-gen presets, ordered Content images, browser draft/public Result | shipped (E8, ADR-024; 0167 xhs-pub script transport, 0168 xhs-images skill + presets) |
| [segmented-episode-speech.md](design/segmented-episode-speech.md) | Voice2 section synthesis, per-section cache, join, then the existing intro sting (ADR-034) | implemented (G13) |
| [voxcpm-daily-voice-driver.md](design/voxcpm-daily-voice-driver.md) | Standalone VoxCPM voice generator: private uv Python worker behind voice-gen (ADR-036) | implemented (G14) |
| [workflow-board-modules.md](design/workflow-board-modules.md) | Native Collect / Daily AI Voice / IT Content Board modules; recorded run settings with Settings → Workflows reuse; local reader and run capture surface | shipped (G8; 0252–0255) |

## 1. CLI commands

Package: `@gobing-ai/knowledge-kit` · Binary: `kk` (alias `knowledge-kit`) · Path: `apps/cli`.

```text
kk --help
kk --version
kk executor run <plugin> --in <path> --out <path> [--plugins-root <dir>] [--plugins-path <dir> …]
kk executor fan-in --in <f1> [--in <f2> …] --out <merged.json> [--plugins-root <dir> | --plugins-path <dir> …]
kk executor fan-out --content <content.json> --target <p1> [--target <p2> …]
                   --out <result.json> [--retry-from <prior-result.json>]
                   [--jobs <n>] [--serial] [--serial-target <plugin> …] [--target-timeout <ms>]
                   [--plugins-root <dir>] [--plugins-path <dir> …]
kk plugin status [--kind <kind>] [--json] [--plugins-root <dir>] [--plugins-path <dir> …]
kk plugin check [<name>…] [--kind <kind>] [--json] [--headed] [--timeout <ms>]
                 [--plugins-root <dir>] [--plugins-path <dir> …]
kk plugin login <name> [--plugins-root <dir>] [--plugins-path <dir> …]
kk stage run <stage> [args…]
kk lock acquire --name <lock> --run <id> [--ttl <ms>] [--db <path>]
kk lock release --name <lock> --run <id> [--db <path>]
kk bot list
kk bot login <url> --save <bot>
kk bot logout <bot>
kk bot open <bot> [--login]
kk store migrate [--db <path>]
kk store ingest --run <id> --in <Doc[].json> --new-ids <path> [--db <path>]
kk store backfill-facts [--db <path>]
kk store label --run <id> --new-ids <path> [--maker <name>] [--mode heuristic|decision] [--db <path>]
kk store label --replay <topic:t|run:id|since:24h> --maker <name> [--decisions <ids>] [--window 24h] [--db <path>]
kk store extract --topic <t> [--window 24h] [--limit <n>] [--include-selected]
                 --out <Doc[].json> [--db <path>]
kk store select --topic <t> --workflow <w> --run <id> --in <Doc[].json|metadata.docs> [--db <path>]
kk store mark-published --topic <t> --run <id> [--in <Doc[].json|metadata.docs>] [--db <path>]
kk store release --run <id> [--topic <t>] [--db <path>]
kk schedule render <schedule> --platform launchd|cron [--repo <dir>]
kk ledger append --workflow <name> --run <run-id> [--works-dir <dir>] [--work-dir <dir>]
kk ledger sync --workflow <name> [--works-dir <dir>] [--work-dir <dir>]
kk board capture --workflow <name> --run <id> --work-dir <dir> --stamp <stamp>
                 [--definition-digest <sha256:digest>] [--setting <key=value> …]
kk board serve --board-origin <origin> [--port <n>]
```

| Command | Description | Status |
| --------- | ------------- | -------- |
| `executor run <plugin>` | Invoke a plugin with input/output files and contract validation | shipped (A21) |
| `executor fan-in` | Merge N `Doc[]` files into one (§1.5) | shipped (A21) |
| `executor fan-out` | Dispatch one `Content` to N publish targets concurrently, bounded by `--jobs`; `--serial-target` names are held out and run alone afterwards (§1.6) | shipped (A21) |
| `plugin status` | List discovered plugins grouped by kind with per-plugin health (`--kind` filter, `--json` report) | shipped (A21) |
| `plugin check` | Run each plugin's live readiness probe (`check` field, ADR-032; verdicts `verified`/`refused`/`error`/`unsupported`; §`plugin check`) | shipped (E93, 0215+0216) |
| `plugin login <name>` | Run the probe in `login` mode with inherited stdio; propagates the probe exit code | shipped (E93, 0215+0216) |
| `store migrate` | Apply pending `@gobing-ai/kk-store` migrations; prints `{db, applied}` (§1.9) | shipped (task 0206) |
| `stage run <stage> [args…]` | Run one stage of the shared workflow stage runner with positional pass-through; the legacy `kk stage <stage>` spelling is normalized into this verb in `main()` before Commander parses (A22 R1/R2) | shipped (task 0275) |
| `lock acquire\|release` | Single-flight lock over the store for the scheduled collector; prints `{acquired}` / `{skipped, holder}` / `{released}` (§1.9). Canonical spelling; `kk store lock …` remains a hidden compatibility route on the same engines | shipped (task 0208; lifted from `store lock` by 0275) |
| `bot list\|login\|logout\|open` | Named local browser sessions over the fixed default profile root: tab-separated inventory, operator-confirmed login/save through a staged transaction, idempotent containment-checked logout behind the shared lease, headed reopen with optional re-login (§1.12) | shipped (task 0276) |
| `store ingest` | Upsert one run's collected `Doc[]` into `items` + `collect_runs` (with per-plugin `source_counts` from `metadata.sources[].file`), write `--new-ids`; prints `{inserted, updated, unchanged}` (§1.9) | shipped (task 0208) |
| `store backfill-facts` | Recompute the typed item facts and the causal `story_id` clustering for every item (idempotent); prints `{updated}` (§1.9) | shipped (task 0227) |
| `store label` | Label the ids `ingest` filed — one raw observation per (decision, maker) through the kk decision catalog (the `LABEL_DECISIONS` table: the heuristic's five + the three judgment decisions the heuristic cannot signal), heuristic-first for those five; a china-politics keyword hit writes a maker `keyword` floor and the model is still consulted; `--replay` re-labels a historical pool under a `replay-<epoch>` run id. Prints `{verdict, confidence, labeled, model, fallback, consults, consultMs, refused}`, or `{replayed, consults, consultMs, run}` (§1.9) | shipped (task 0209; raw observations + replay 0226; judgment decisions + china-politics gate 0229; score positions + refusals 0240) |
| `store extract` | Compile a topic profile into one store query and write the pool as `Doc[]` (labels inlined), excluding the topic's already-selected stories and gating on the profile's `where` keys (the shipped ai-news profile's `kk-item-china-politics: { lte: 1 }` excludes an unjudged item, fail-closed); prints `{count}` (§1.9) | shipped (task 0210; topic-scoped exclusion 0228; china-politics gate 0229) |
| `store select` | Record a run's planned set as `selected` stories for one topic (idempotent); prints `{selected}` (§1.9) | shipped (task 0228) |
| `store mark-published` | Promote a run's `selected` rows to `published`; prints `{published}` (§1.9) | shipped (task 0228) |
| `store release` | Drop a run's `selected` rows so its items re-enter the pool; prints `{released}` (§1.9) | shipped (task 0228) |
| `schedule render` | Print the launchd plist / crontab line for a shipped workflow (§1.11); installing it is an operator action | shipped (task 0208) |
| `ledger append` | Append one workflow run section to `<works-dir>/<name>/ledger.md` from `spur workflow trace`; prints `{workflow, ledger, appended}` (§1.10) | shipped (task 0207) |
| `ledger sync` | Append every finished run of the workflow missing from its ledger, oldest first (same printed shape) (§1.10) | shipped (task 0207) |

> **Surface status.** Rows marked *shipped* are live in `apps/cli` (transcribed from the code
> registrations). The first-layer nouns are `executor` and `plugin` (ADR-011, feature **A21**),
> extended by `stage` (§1.8, ADR-011 amendment 2026-09-18) and `store` (§1.9, task 0206) and
`ledger` (§1.10, task 0207) and `schedule` (§1.11, task 0208) and `lock` (ADR-037, task 0275); the
> engines shipped with **A2** / **B6** keep their flags and exit codes, only the
> canonical paths changed. Hidden one-release aliases `invoke` / `fanin` / `fanout` / `plugins *`
> still reach the same engines but are not listed in `kk --help`; the same holds for the legacy
> `store lock …` route (ADR-037, task 0275). Non-canonical names are hidden, never announced:
> no deprecation text reaches stdout/stderr. §1.5/§1.6 are callable today. The
> spec's `--dedupe` flag is deliberately deferred, not shipped — see §1.5.

### `executor run`

| Arg / Option | Type | Required | Default | Description |
| -------------- | ------ | ---------- | --------- | ------------- |
| `<plugin>` | string | yes | — | Name of plugin to resolve from the merged registry |
| `--in <path>` | string | yes | — | Input file path (or source path for ingestion) |
| `--out <path>` | string | yes | — | Output file path written by plugin |
| `--plugins-root <dir>` | string | no | — | Exclusive single-root scan (isolation/tests only; no union with defaults) |
| `--plugins-path <dir>` | string[] | no | — | Extra plugin root to union with the default roots (repeatable; tree, kind collection, or single `plugin.json` dir) |

**Behavior:**

1. Resolves `<plugin>` name via `discoverAllPlugins` & `getByName`; `--plugins-root` selects
   an exclusive root through that same merged entry point, including single-plugin directories.
2. Validates input file against kind's input schema before spawn (fails loud if schema violated).
3. Spawns plugin entry executable with `--in <in>` and `--out <out>`.
4. On non-zero entry exit, fails loud and surfaces error message (returns entry exit code).
5. Validates output against the kind's output schema. Publish invocations additionally reject a
   parsed `Result { ok: false }` as an invocation failure (exit 1; artifact kept, 0110 I6).
   Manifest-declared `operations` dispatch (0110 I3) validates input/output per declaration;
   undeclared array dispatch is rejected pre-spawn.
6. `--plugins-root` and `--plugins-path` are mutually exclusive (usage error, exit 2).
7. Rejects `--in`/`--out` naming the same file — identity (dev+ino), not path string — pre-mutation (0110 I5, hardened 0157 R1) and unlinks the stale
   `--out` file before spawn, so only output produced by this invocation can establish success.

**Implementation:** `apps/cli/src/invoke.ts` (engine). Shipped in task 0110: the publisher input
schema is `Content` again; the podcast-pub array show-notes form is a manifest-declared
`operations["show-notes"]` (doc-list → markdown) reachable only through the executor's declared-op
dispatch — no undeclared `Doc[]` can bypass output-schema validation. Completion is fresh,
validated output (stale `--out` unlinked pre-spawn) and a valid `Result { ok: false }` exits 1
with the artifact preserved.

### `plugin status`

| Option | Type | Required | Default | Description |
| -------- | ------ | ---------- | --------- | ------------- |
| `--kind <kind>` | string | no | — | Filter by plugin kind (`ingestion`, `generator`, `publish`) |
| `--json` | boolean | no | `false` | Emit the machine-readable unified health report |
| `--plugins-root <dir>` | string | no | — | Exclusive single-root scan (isolation/tests only; no union with defaults) |
| `--plugins-path <dir>` | string[] | no | — | Extra plugin root to union with the default roots (repeatable; tree, kind collection, or single `plugin.json` dir) |

**Behavior:**

1. Default discovery runs `discoverAllPlugins` — a merged low→high scan of the package-shipped
   built-in tree, `~/.config/kk/plugins` (when present), CWD `./plugins` (when present and not the
   built-in realpath), `KK_PLUGIN_PATH` entries, and `--plugins-path` dirs (ADR-012).
   `--plugins-root` skips the defaults and scans that one root only.
2. Filters by `--kind` if specified. Health is **tree-wide**: `healthy` and `diagnostics` are
   computed over the full merged tree before filtering, so a `--kind` report can be
   `healthy: false` with every listed plugin healthy (unfiltered diagnostics name the offenders).
3. Builds the unified report `{ healthy, plugins, diagnostics }` — one entry per discovered
   `PluginRecord` (including `origin`: `builtin` \| `project` \| `user` \| `path`) augmented with
   `healthy` and `diagnostics`; tree-level discovery diagnostics (`misplaced`, `kind_mismatch`,
   `malformed`, `duplicate_name`, `shadowed`, `unreadable`) stay in the top-level `diagnostics`
   array and are never dropped.
4. `missing_entry` (entry file absent on disk) attaches to the owning plugin's `diagnostics` and
   counts toward that plugin's `healthy: false`.
5. Under `--json`, writes the unified object to stdout via `logger.out`; under standard text,
   prints records grouped by kind with a per-plugin `[healthy]` / `[unhealthy]` mark, then any
   diagnostics to stderr via `logger.error`.
6. Exits code `1` when any diagnostic exists (plugin-level or tree-level), `0` when healthy;
   exits `2` when `--plugins-root` and `--plugins-path` are combined.

**Implementation:** `apps/cli/src/commands/plugin.ts` (`registerPluginCommand`).

### `plugin check`

| Option | Type | Required | Default | Description |
| -------- | ------ | ---------- | --------- | ------------- |
| `<name>…` | string[] | no | all discovered | Probe only these plugins; an unknown name is a usage error (exit `2`) |
| `--kind <kind>` | string | no | — | Filter by plugin kind (`ingestion`, `generator`, `publish`); invalid value exits `1` |
| `--json` | boolean | no | `false` | Emit the machine-readable verdict report |
| `--headed` | boolean | no | `false` | Forward `--headed` to each probe (opt-in visible browser; headless is the default) |
| `--timeout <ms>` | number | no | 30000 | Forward `--timeout` to each probe; a probe exceeding it is killed and reported `error`, never `refused` (ADR-032 R3) |
| `--plugins-root <dir>` / `--plugins-path <dir>` | as `plugin status` | no | — | Same exclusive-root semantics; combining them exits `2` (ADR-012 R6) |

**Behavior (ADR-032):** for every selected `PluginRecord` with a manifest `check` field, spawns
`<check> check [--headed] [--timeout <ms>]` through the sanctioned spawn seam (`spawnPluginProbe`,
`apps/cli/src/invoke.ts`) with piped stdio, the same operator-config env as `executor run`, and the
`KK_PLUGIN_KIND`/`KK_PLUGIN_NAME` env. Records without `check` are reported `unsupported` without spawning
(`status` still spawns no probe at all — R2). The last non-empty stdout line is parsed as
`{ status, profileDir?, detail }`; `verified`/`refused` are trusted only when the probe exited `0`/`1`, any
other combination collapses to `error`. A missing/malformed final line gives detail
`probe exit <n> (malformed probe output)`; a well-formed `{"status":"error","detail":…}` line (the probes'
exit-2 path, e.g. substack's unset `SUBSTACK_PUBLICATION_URL`) gives `probe exit <n>: <detail>`; any other
status/exit mismatch gives `probe exit <n>`. Raw probe stdout/stderr is never echoed (R5).
Probes run sequentially. Exit code: `0` when every verdict is `verified` or `unsupported`, `1` when any probe
is `refused`/`error`. Under `--json`: `{ ok, plugins: [{ name, kind, status, profileDir?, detail }] }` where
`ok` mirrors the exit code.

### `plugin login`

`kk plugin login <name>` takes one plugin that has a `check` field, spawns `<check> login` with **inherited**
stdio (interactive browser/credential flow), and exits with the probe's code. A missing/unknown plugin or one
without `check` is a usage error naming the `check` field (exit `2`); the probe's exit code propagates otherwise.

### 1.5 `executor fan-in` — shipped (A21; engine B6)

Merges N `Doc[]` files into one. Sibling of `executor run` so the single-plugin invoker contract
stays intact (ADR-006). Spec: `docs/design/fan-in-and-fan-out-specification.md` §1.2, §2.
Canonical path is `kk executor fan-in`; `kk fanin` is a hidden one-release alias (ADR-011).
A missing `--out` parent directory is created (ADR-016); a write that genuinely fails still exits
non-zero.

```text
kk executor fan-in --in <f1> [--in <f2> …] --out <merged.json> [--plugins-root <dir> | --plugins-path <dir> …]
kk executor fan-in --source <plugin>:<f1> [--source <plugin>:<f2> …] [--source-timeout <ms>] [--source-timeout-override <plugin>:<ms> …] --out <merged.json> [--plugins-root <dir> | --plugins-path <dir> …]
```

| Option | Type | Required | Default | Description |
| -------- | ------ | ---------- | --------- | ------------- |
| `--in <file>` | string (repeatable) | yes* | — | Input `Doc[]` JSON files to merge |
| `--source <plugin>:<file>` | string (repeatable) | yes* | — | Ingestion source to spawn concurrently: plugin name and its input file |
| `--source-timeout <ms>` | positive integer | no | 1800000 | Per-source timeout; a source cut short is recorded as failed |
| `--source-timeout-override <plugin>:<ms>` | `<plugin>:<positive int>` (repeatable, once per plugin, plugin must be a `--source`) | no | — | Per-source timeout override for one named source — wins over `--source-timeout`/default for that source only (0099: the daily workflow pins `horizon-ingest:2700000` — horizon solo ran 28m39s in 0098 r7, straddling the 30m default) |
| `--out <file>` | string | yes | — | Output merged `Doc[]` JSON path |
| `--plugins-root <dir>` | string | no | — | Exclusive single-root scan for `--source` discovery (isolation/tests only; no union with defaults) |
| `--plugins-path <dir>` | string[] | no | — | Extra plugin root to union with the default roots for `--source` discovery (repeatable; tree, kind collection, or single `plugin.json` dir) |

\* At least one `--in` or `--source` is required (runtime exit `2`); the two modes combine.

**Behavior (`--in` merge mode):** validate each input against `DocListSchema` (missing / unreadable /
invalid-JSON / schema-violating file exits `1` naming the file) → dedupe by `Doc.id` (first-seen
wins; later duplicates contribute only their provenance) → append `metadata.sources: Array<{ file,
sourceUri? }>` in `--in` order → keep first-appearance order → write merged `Doc[]`. Exit `0` on
success, `2` on usage errors. **Deferred:** spec §1.2's `--dedupe <id|uri|none>` flag is **not
shipped** — id dedupe (default) is the only rule; add the flag if a `uri`-dedupe consumer appears
(task 0042).

**Source-runner mode (`--source`, L1 / ADR-019):** each `--source <plugin>:<inputFile>` resolves
against the same merged plugin registry as `kk invoke`, must be an `ingestion`-kind plugin, and is
spawned concurrently through `invoke.ts`'s async spawn seam (`spawnPluginEntryAsync`; fan-in never
spawns directly — `no-direct-process-spawn`). A failed, timed-out, or invalid-output source degrades
to a `metadata.sourceErrors[]` entry (`{ plugin, error, durationMs }`, echoed to stderr) on the
merged docs without aborting siblings; the output is written when ≥1 source succeeded (exit `0`),
and exit `1` with no output only when every source failed. Provenance for source docs is the plugin
name; merge order is `--in` inputs first, then `--source` declaration order (deterministic output).
`--source` discovery honours `--plugins-root` (exclusive single root) and `--plugins-path`
(union with the defaults); combining the two is a usage error (exit `2`, ADR-012 R6).

**Timeout semantics (0110 I2, shipped):** a `timeoutMs` timeout kills the source plugin's whole
process tree — descendants first, then the entry (`killProcessTree`, POSIX `pgrep -P` walk),
reaped via a self-managed timer so the tree walk runs while the entry is still alive. The result
surfaces as exit 1 with `timedOut: true`; sibling sources are unaffected. Existing timeout flags
stay unchanged.

### 1.6 `executor fan-out` — shipped (A21; engine B6)

Dispatches one `Content` to N publish targets **concurrently**, emitting one aggregate `Result`
(ADR-007 R4 amendment 2026-10-03: the engine runs one node at a time, so the fan-out is where N
independent publishers overlap — the same split ADR-019 made for `fan-in`).
Spec: `docs/design/fan-in-and-fan-out-specification.md` §1.3, §3–§6.
Canonical path is `kk executor fan-out`; `kk fanout` is a hidden one-release alias (ADR-011).
A missing `--out` parent directory is created (ADR-016); a write that genuinely fails still exits
with code 2.

```text
kk executor fan-out --content <content.json> --target <p1> [--target <p2> …] \
                    --out <result.json> [--retry-from <prior-result.json>] \
                    [--jobs <n>] [--serial] [--serial-target <plugin> …] [--target-timeout <ms>]
                    [--plugins-root <dir>] [--plugins-path <dir> …]
```

| Option | Type | Required | Default | Description |
| -------- | ------ | ---------- | --------- | ------------- |
| `--content <file>` | string | yes | — | `Content` JSON to publish |
| `--target <plugin>` | string (repeatable) | yes (≥1)\* | — | Publish plugin name per target; duplicate names are deduped, so each distinct target is attempted once |
| `--out <file>` | string | yes | — | Aggregate `Result` JSON path |
| `--retry-from <file>` | string | no | — | Prior `Result`; published/skipped targets carried as `skipped` (url/id **and metadata** preserved, 0110 I4), only prior failures re-dispatched; failures outside the explicit selection are retained as `failed` in the aggregate (0110 I7) |
| `--serial` | boolean | no | `false` | Dispatch the parallel batch one target at a time (pre-2026-10-03 behaviour; use when the transports share a resource) |
| `--jobs <n>` | number | no | every target at once | Concurrent-start bound for the parallel batch; `--jobs 1` is equivalent to `--serial` |
| `--serial-target <plugin>` | string (repeatable) | no | — | Target kept out of the parallel batch and run alone **after** it, e.g. a headed browser channel or a publisher that shares a checkout |
| `--target-timeout <ms>` | number | no | — | Per-target wall-clock budget; an overrun is recorded `failed` (`exceeded its <ms>ms budget`) and siblings continue |
| `--plugins-root <dir>` | string | no | — | Exclusive single-root scan (isolation/tests only; no union with defaults) |
| `--plugins-path <dir>` | string[] | no | — | Extra plugin root to union with the default roots (repeatable; tree, kind collection, or single `plugin.json` dir) |

\* `--target` is required unless `--retry-from` supplies the retry set; explicit `--target` values
then narrow the dispatch to the still-unpublished subset.

**Behavior:** validate `--content` against `ContentSchema` and every target against the publish
registry (default merged discovery via `discoverAllPlugins`; malformed flags, invalid content, an
unresolvable target, or combined `--plugins-root`/`--plugins-path` exits `2`) → dispatch the
non-serial targets together (bounded by `--jobs`) and the `--serial-target` names one at a time
afterwards, one `TargetOutcome` per target → write the aggregate `{ ok, summary: { total,
succeeded, failed, skipped }, targets }` (spec §3.1) to `--out`.

**Exit-code contract:**

| Outcome | Exit | Aggregate `Result` |
| --------- | ------ | -------------------- |
| All targets published | `0` | every dispatched entry `published` (carried retry entries `skipped`) |
| Some published, some failed | `1` | mixed entries; successes retain `published` |
| All targets failed | `1` | every entry `failed` |
| CLI / input error (malformed flags, invalid `--content`, unresolvable target, `--out` write failure) | `2` | nothing written to `--out` |

Partial success is **not** exit 0 — the run fails loud (ADR-007 R5), while successful targets stay
published and are individually re-runnable via `--retry-from` (spec §5).

**Timeout semantics (0248, shipped):** `--target-timeout <ms>` is the per-target wall-clock budget,
enforced by the owning spawn rather than by a fan-out-side race: on overrun the publisher's whole
process tree (descendants first, then the entry) is killed and reaped before the fan-out reads or
discards that target's temporary output, so a timed-out publisher leaves no live descendant and no
late output. The target is recorded `failed` naming the target and the budget; siblings continue.

**Retry semantics (0110 I4/I7, shipped):** prior ledgers are validated against kk-core's
`AggregateResultSchema` (`TargetOutcomeSchema` per entry), so a wrong-typed optional field
(`url: 5`) is a named input error rather than a silently dropped field; `TargetOutcome.metadata`
round-trips through read and
carry-forward (Surfdash's `postPath` survives), with a primitive `metadata` value in a prior
ledger named as an input error (exit 2). Aggregate order is `skipped` → retained `failed` →
fresh outcomes; unselected prior failures keep `ok: false` and exit 1. Target eligibility per
spec §5: without explicit targets, exactly the prior failures retry; an explicit `--target`
selection narrows the attempt set (deduped, published names stay skipped) and previously
unattempted names remain eligible. No new result fields or flags.

### `kk board` — Board reader and run capture (G8, task 0252)

Two verbs over the frozen contract in `docs/design/workflow-board-modules.md` §9.

**`kk board capture`** binds a run id to its canonical workspace and its sanitized effective
settings, then writes the immutable record `.works/.board/runs/<run-id>.json` and the workspace
ownership marker `<work-dir>/.kk-board-owner.json` atomically, revoking the previous owner first.

| Flag | Meaning |
| -------- | --------- |
| `--workflow <name>` | one of `kk-collect`, `kk-daily-ai-voice2`, `kk-itc` |
| `--run <id>` | single safe path segment |
| `--work-dir <dir>` | run workspace below a works root (`.works/` or `works/`), or a canonical child of the configured works root when the caller passes it as a trusted binding (`kk daily prepare`); a relative path resolves against the project. `/`, the home tree, the project root, an ancestor of the project, the config tree and a works root itself are refused |
| `--stamp <stamp>` | alphanumerics, dash, underscore, `T`/`Z` |
| `--definition-digest <sha256:…>` | optional; topology is recorded only on exact `spur workflow list --json` agreement, else a diagnostic and no topology |
| `--trusted-root <dir>` | optional; a configured works root whose canonical CHILD may be captured (an external ITC workspace). The root itself, the home/config tree and the project are refused; the ITC path defaults to the configured works dir |
| `--setting <key=value>` | repeatable; allowlisted per workflow. A non-allowlisted key is dropped, never captured; free text (topics, titles, prompts, paths) is never capturable |

Capture never initiates content work and never depends on the reader being alive. A failed
*optional* capture after a successful revocation warns and leaves artifact access disabled rather
than aborting production; a failed revocation refuses the result mutation entirely.

**`kk board serve --board-origin <origin> [--port <n>]`** runs the read-only reader on `127.0.0.1`
(default port 4340) with `GET`/`HEAD`/`OPTIONS` only:
`/api/health`, `/api/workflows/<name>/runs/<id>/results`, `…/config`, `…/artifacts/<opaque-id>`.
Exact-Origin plus loopback-Host are required, every read is containment- and symlink-checked and
re-verifies the workspace owner before the response is written, text/JSON previews cap at 1 MiB, and
media is served as byte ranges. Status vocabulary: `400` bad identity or query, `403` foreign
origin or project, `404` unknown capture/artifact or a changed owner, `405` mutating method, `416`
unsatisfiable range, `422` malformed stored evidence, `503` Board authority unavailable.

**Operator setup (checkout).**

1. Build the browser contributions: `bun scripts/build-board.ts` (invoked by the root `build` and by
   the CLI `build:bundle`/`prepack`, so a packed install ships them).
2. Declare each module in `.spur/config.yaml` under `bootstrap.modules`: `type: react`,
   `directory: apps/cli/dist/board/<entry>`, `entry: index.js`, `styles: [index.css]`, and one of
   `id: kk-collect | kk-daily-ai-voice2 | kk-itc`. This checkout ships the declaration **disabled**
   (`enabled: false`): the host validates every `directory` at *server start*, so an enabled
   declaration makes `spur serve` fail with `bootstrap.modules[<i>] ("kk-…"): module directory "…"
   was not found` on any checkout that has not built the assets — and `apps/cli/dist/board` is a
   gitignored build tree. **Build first, then enable:** after step 1 flip `enabled` to `true` (or
   delete the flag; the host default is `true`) to show the modules. An installed user points
   `directory` at their installed package's own `dist/board/<entry>` tree and needs neither this
   checkout nor a `node_modules` edit.
3. Start the Board: `spur serve --host 127.0.0.1 [--port <n>]`; the UI is `/board`.
4. Start the reader in a second terminal: `kk board serve --board-origin http://127.0.0.1:<board-port>`
   (default port 4340, `127.0.0.1` only). It is a foreground process with no daemon or scheduler.
5. Open a module at `/board/modules/<id>` on the Board origin. The module PAGE is mounted by the
   SPA under the `/board` app prefix at `/board/modules/<id>`; its bundles are served from the bare
   `/modules/<id>/index.js` + `/modules/<id>/index.css` (the descriptor's `route`/`entryUrl` in
   `GET /api/board/modules` use that `/modules/<id>` prefix). Opening the bare `/modules/<id>` page
   only shows the SPA's own 404. Definitions stay in **Settings → Workflows**
   (`/board/settings/workflows`). A validated `kkApi` query parameter selects a non-default loopback
   reader port and is retained in saved URLs.

**Restart / shutdown.** Both processes are foreground and stateless. `Ctrl-C` (SIGINT/SIGTERM) stops
the Board (it releases the scheduler owner lock, stops its job children, closes the DB) and the
reader. Restart the Board only after `.spur/config.yaml` changes — module declarations and asset
paths are read at start; restart the reader only after a `kk board capture` wrote a new run record.
A reader restarted on a different port needs a fresh `?kkApi=http://127.0.0.1:<port>` in the module
URL. The reader never migrates or writes the KK store.

**Installed-package acceptance.** `apps/board/tests/installed-board.test.ts` packs the CLI
(`bun pm pack`, honoring `prepack`), installs the tarball into a throwaway project, starts the
installed `spur` Board against that project's declaration pointing at the installed
`dist/board/<entry>` trees, and drives the three routes plus Settings → Workflows with real Chromium
(Playwright, pinned by the root catalog `playwright: catalog:`, declared in `apps/board`). It asserts
the served bundles are byte-identical to the installed package files, so no source-checkout import
can satisfy it. A missing Chromium binary FAILS the setup (`bunx playwright install chromium`) —
never a silent skip.

**Legacy evidence limits.** The reader serves only runs captured through `kk board capture` (0252+).
A pre-capture run has no `.works/.board/runs/<id>.json`: the reader answers `404` and the module shows
an explicit no-captured-results state — nothing is reconstructed from dates, mtimes or "latest"
folders. An existing workspace without a matching owner marker is `unverified`; a workspace owned by
another run is `superseded`, so its config and Spur progress survive but its artifact bytes are not
served. Workflow Config Summary shows only sanitized recorded run values — current definitions and
defaults live in Settings → Workflows, and uncaptured historical keys stay explicitly unknown. All
operation is local-loopback and read-only; there is no remote or multi-user mode.

**Board contribution ABI.** The three entries export `webModule = { apiVersion: 1, component }` using
the type-only `@gobing-ai/spur/board` declaration; the installed host advertises `react`,
`react/jsx-runtime` and `react/jsx-dev-runtime` as facade specifiers in `web/board-runtime.json`, and
the build externalizes exactly the three (the production JSX runtime emits only the first two). These
remain MEDIUM for a future host: the ABI is read from the installed Spur (kept at latest; the noted version is
the observation date's) and exercised end-to-end by
the installed-package test, but no forward-compatibility promise is made.

### `kk daily prepare` Board capture + the Daily AI Voice module (G8, task 0253)

`kk daily prepare` gains the capture seam when the launch injects a run identity: `--run <id>` (the
engine `vars.__runId`), `--definition-digest <sha256:…>` (`vars.__definitionDigest`) and repeatable
`--setting <key=value>` for the §9 daily allowlist. Without `--run` — voice1 and direct callers —
prepare is unchanged. The capture runs after the workspace is composed and before any result
producer, so a refused revocation stops the run before it writes results. The daily workspace lives
under the configured works root (``KK_WORKS_DIR`` > config `works_dir` > `~/.config/kk/works`), which
is usually OUTSIDE the project: `captureRun` accepts a path outside a `.works`/`works` tree only when
the caller passes that exact configured root as a trusted binding, and then only its canonical CHILD
— never the root, the home/config tree or the project.

The `kk-daily-ai-voice2` module (`apps/board/src/daily-voice`, built to `apps/board/dist/daily-voice`
and `apps/cli/dist/board/daily-voice`) renders the four shared tabs over the reader's daily
projection (`apps/cli/src/board/daily-voice.ts`): a **Summary** that keeps execution status apart
from the published outcome, a **Results** tab with the article/cover/script/final audio, the run
report and per-channel draft/live/skipped/failed outcomes with validated public links, an
**Execution progress** tab built from the DAG's run-detail action rows (retry siblings stay distinct)
plus the captured digest-verified edges — unknown edges stay unknown and link Settings → Workflows —
and a **Workflow Config Summary** of the sanitized captured settings only. ADR-034 section audio is
optional: only recorded output descriptors are served, and absent evidence is `unavailable`, never
an invented zero. The digest-first topology capture, the artifact-only projection and the DAG
producer fallback are frozen in `docs/design/workflow-board-modules.md` §9.

### `kk-itc` Board capture + the IT Content module (G8, task 0254)

`kk-itc` is a state machine. Its `prepare` node now declares and forwards `vars.__runId` and
`vars.__definitionDigest`, so after the existing `prepare-itc` staging succeeds it binds the run to
its workspace through `kk board capture --workflow kk-itc` (with the §9 ITC setting allowlist:
booleans `research,judge,auto,unslop,force,publish_live,cover_enabled,inline_images`, integer
`max_revisions`, enum `source_locale`). The capture runs *after* preparation and *before* any
authoring action; `prepareWorkspace`'s XOR/force validation, early `.revise-count` initialization
and solo-podcast sharing are untouched, and an out-of-breadth workspace (or an absent run identity)
only warns — it never aborts authoring. ITC's default workspace is `$works_dir/kk-itc/<kebab>`, so
the configured works dir is the trusted binding for a caller-supplied external `--work-dir`; `/`,
the home tree, the config tree and the project root are refused.

The IT Content module (`apps/board/src/itc`, built to `apps/board/dist/itc` and
`apps/cli/dist/board/itc`) renders the four shared tabs over the reader's ITC projection
(`apps/cli/src/board/itc.ts`, registered in the fixed ITC artifact manifest):

- **Summary** — run id/start/elapsed, execution status kept apart from the recorded result outcome,
  the judge verdict and confidence, the recorded revision rounds, the target counts and the run
  report, with every unknown explicit.
- **Results** — bounded outline alternatives and the selected outline, a bounded draft preview, the
  judge verdict/feedback, the recorded revision evidence, the optional cover illustration, the
  per-target outcomes and the final report. Per-target results are read from the publisher-written
  `4-publish/fanout-result.<variant>.json` and `4-publish/result.<target>.json` files, whose names
  come from the run's own `4-publish/publish-plan.json` (never a browser path); BOTH recorded Result
  shapes are parsed (a fan-out `targets[]` aggregate and a single top-level `{ok, target, …}`
  object). Out-of-vocabulary judge confidences are reported unknown, never echoed.
- **Execution progress** — the state machine's recorded `states[]` visits and attempts, timings and
  operator-wait/failure diagnostics (shared with Collect); no execution action is offered.
- **Workflow Config Summary** — the sanitized captured run settings only; a legacy run without a
  capture reports uncaptured keys, not today's defaults. Current definitions stay in Settings →
  Workflows (`/board/settings/workflows`).

Revision counts are derived from the recorded `draft-revise`/`draft-autorevise` visits, never the
mutable `.revise-count` files; missing evidence is `unavailable`/`unknown`, never a zero. The
per-target derivation, the judge-confidence validation and the trusted-root binding are frozen in
`docs/design/workflow-board-modules.md` §9.

## 1.7 `plugin.json` manifest surface

#### API/library claim sources and confidence

| Claim | Source | Local verification | Confidence |
| --- | --- | --- | --- |
| A module declaration is a `.strict()` discriminated `react`/`iframe` union, `id` must match `^[a-z][a-z0-9-]*$`, and a duplicate id or a reserved-host-identity collision is refused at config load | installed `@gobing-ai/spur` bundle: `boardModuleDeclarationSchema`, `validateBoardModuleDeclarations` | Read the emitted zod shapes in `node_modules/@gobing-ai/spur/spur.js` (0.4.2) | HIGH |
| The module PAGE route is `/board/modules/<id>` (the SPA mounts `.kk-board` there), while the ASSET route and the descriptor-advertised `route`/`entryUrl` use the bare `/modules/<id>` prefix (`/modules/<id>/index.js`); the declaration carries no route field | installed `BOARD_MODULE_ROUTE_PREFIX` / `boardModuleRoute(id)` plus the SPA router | Confirmed live with real Chromium and `GET /api/board/modules`: it lists `route: "/modules/kk-collect"` and `/modules/kk-collect/index.js` returns `text/javascript`, but the bare `/modules/kk-collect` page renders the SPA 404 while `/board/modules/kk-collect` mounts the module (`web/board-runtime.json` `reservedModules` are the separate `board/<route>` family) | HIGH |
| `bootstrap.modules` is validated by the RUNTIME schema only — the shipped `schemas/spur-config.schema.json` `bootstrap` block lists just logging/telemetry/database/scheduler | installed `schemas/spur-config.schema.json:20` and the bundle's `bootstrapSectionSchema` | Read both files in `node_modules/@gobing-ai/spur` (0.4.2) | HIGH |
| An ENABLED `bootstrap.modules` entry whose `directory` is missing (or resolves outside the project root) makes `spur serve` exit 1 before it listens; `enabled: false` starts normally | installed `node_modules/@gobing-ai/spur/spur.js` `prepareBoardModules` + the `bootstrap.modules[<index>] ("<id>"): <reason>` error shape | Probed live in a throwaway project: enabled with an absent/outside dir printed `bootstrap.modules[0] ("kk-collect"): "…" resolves outside the project root …` and exited 1; the same entry with `enabled: false` reached `Spur server listening on …` | HIGH |
| The host advertises `react`, `react/jsx-runtime` and `react/jsx-dev-runtime` (plus `react-dom`, `react-dom/client`, `react-router`, `react-router/dom`) at React 19.2.1 / ReactDOM 19.2.1 / React Router 7.11.0 | installed `web/board-runtime.json` | Read `node_modules/@gobing-ai/spur/web/board-runtime.json:4-11`; all seven named `web/_astro/board-facade-*.js` assets exist on disk | HIGH |
| The reader answers 400/403/404/405/416/422/503 for the cases this section names | the shipped reader in this repo | `apps/cli/src/board/reader.ts:207,217,296,414,488` and the per-status tests in `apps/cli/tests/board/reader.test.ts:177,189,202,266,326,371` | HIGH |
| `GET /api/runs/:runId/progress` answers 404 `RUN_NOT_FOUND` once the projection carries an `orphan-row` diagnostic, which is why DAG progress falls back to run-detail action rows | installed bundle: the progress handler guard and `projectWorkflowProgress`'s diagnostic push | Read both in `node_modules/@gobing-ai/spur/spur.js` (0.4.2); the fallback is `apps/cli/src/board/reader.ts:354` | HIGH |

## 1.7 `plugin.json` manifest surface
Product plugins live under kind collections (ADR-009):

| Collection | `kind` | Example |
| ------------ | -------- | --------- |
| `plugins/ingestions/<name>/` | `ingestion` | `plugins/ingestions/karakeep-local` |
| `plugins/generations/<name>/` | `generator` | `plugins/generations/content-gen`, `plugins/generations/image-gen` |
| `plugins/publishings/<name>/` | `publish` | `plugins/publishings/surfdash-pub` |

Default runtime discovery is a **merged multi-root scan** (ADR-012): the package-shipped built-in
tree, `~/.config/kk/plugins` (when present), CWD `./plugins` (when present and not the built-in realpath),
`KK_PLUGIN_PATH` entries, and repeatable `--plugins-path` dirs — low→high priority, a later root
shadowing an earlier `name` (with a `shadowed` diagnostic). `--plugins-root` is the exclusive
single-root override (isolation/tests only) and stays the same scan the old default `./plugins`
performed. Passing a collection directory itself is also valid as a root. `plugins/kk` is the
Claude Code capability plugin and is never discovered as a kk-core plugin.

Every product plugin directory carries a `plugin.json`. Schema:
`PluginManifestSchema` (`packages/kk-core/src/manifest.ts`), a `z.looseObject` — unknown keys are
preserved, not rejected.

| Field | Type | Required | Status | Description |
| ------- | ------ | ---------- | -------- | ------------- |
| `name` | string (min 1) | yes | shipped | Unique plugin name; the argument to `kk executor run` |
| `kind` | `ingestion` \| `generator` \| `publish` | yes | shipped | Selects the I/O data contract via `kindContract(kind)` |
| `entry` | string (min 1) | yes | shipped | Relative path to the executable entry the invoker spawns |
| `version` | string | no | shipped | Informational |

**Spawn seam (shipped).** `pluginEntryCmd` (`apps/cli/src/invoke.ts:125`) runs `.ts`/`.js` entries under
`bun`; any other `entry` is spawned **directly as an executable** — a non-TS plugin ships a shebang
wrapper as its entire integration seam (e.g. `omni-voice-gen`'s `bin/omni-voice-gen`, which execs
`uv run --project <plugin> python -m omni_voice_gen`). The manifest alone selects the spawn mode; no
`package.json` or runtime registration is required.
| `description` | string | no | shipped | Informational |
| `accepts` | `('brief' \| 'docs')[]` | no | **specified — not implemented** (D) | Generator-only. Declares which input shapes the plugin handles; defaults to both when absent. Lets a mismatch fail at **resolve time** rather than inside the plugin |
| `operations` | `Record<string, { input: 'doc-list' \| 'markdown', output: 'doc-list' \| 'markdown' }>` | no | shipped (0110 I3) | Named non-Result operations the plugin accepts (e.g. podcast-pub `show-notes`: doc-list → markdown). Only declared operations can receive non-`Content` inputs; undeclared array dispatch is rejected pre-spawn |
| `check` | string (min 1) | no | shipped (E93, 0215) | Relative path to the live-readiness probe entry. Present ⇒ `kk plugin check`/`login` spawn it (ADR-032 probe contract, §`plugin check`); absent ⇒ the plugin is `unsupported` for live checks. Resolved to an absolute path on `PluginRecord.check` |

**Resolve-time validation (shipped).** `kk executor run` resolves the manifest, selects the contract with
`kindContract(record.kind)` (`apps/cli/src/invoke.ts:271`), and validates the input file with
`contract.input.safeParse(json)` (`apps/cli/src/invoke.ts:326`) **before** spawning the entry — a
schema violation exits non-zero with `Input schema violation for kind '<kind>': <issues>`.

**Planned extension (feature D).** Once the generator contract widens to `GeneratorInput`
(`{ brief?, docs? }`, at least one), the same resolve-time step also checks the populated keys
against `accepts`. A brief-only input handed to an `accepts: ["docs"]` generator fails with a named
error rather than a silent empty `Content`. **Migration note:** the existing `content-gen` plugin
does *not* survive this change unchanged — its entry must read `{ docs: Doc[] }` instead of a
root-level `Doc[]` array, and should declare `"accepts": ["docs"]`.

**Declared operations dispatch (shipped, 0110 I3).** A publish `Doc[]` input is accepted only when
the manifest declares an `operations` entry with `input: 'doc-list'` — selection is first-match
across declared ops (`apps/cli/src/invoke.ts:311`). No matching op (or no `operations` at all) is
rejected **before spawn** (`Publish plugin '<name>' received a Doc[] array but declares no
doc-list operation; a Content object is required`). A matching op has its `Doc[]` validated with
`DocListSchema`, dispatches, and its `output` form decides completion checking — `markdown` ops
check artifact existence/non-empty only, `doc-list` ops validate the array. Ordinary `Content`
invocations bypass operations entirely and validate against `kindContract('publish').input`/`.output`
as before; a publish whose `Result` parses but carries `ok: false` fails the invocation
(`reported failure: <reason>`, exit 1, artifact kept for inspection, 0110 I6). `--in` and `--out`
naming the same file (dev+ino identity, not path string — 0157 R1) is rejected pre-mutation (0110 I5); the exact `--out` path is unlinked
before spawn, so success always reflects fresh output (delete-or-verify).

### 1.8 `stage` — shipped (F8; task 0133; canonical verb 0275)

`kk stage run <stage> [args…]` runs one stage of the shared workflow stage runner
(`plugins/kk/scripts/kk-workflow-stages.ts`) with positional pass-through, so workflow shell steps
do not re-resolve the script path themselves. Unknown options are allowed and forwarded. The exit
code is the stage's own; a non-zero code throws `CommanderError` (`kk.stage.failed`). The `stage`
group carries no default action: `kk stage` alone prints usage, `kk stage run --help` is the verb
help and `stage run` with no stage is a canonical usage error. The shipped `kk stage <stage> [args…]`
spelling stays a compatibility route: `main()` normalizes it to `stage run …` before Commander parses
(`normalizeStageArgs` in `apps/cli/src/commands/stage.ts`, A22 R2), preserving argv prefixes, the root
`-v`/`--verbose` globals, `--` separators and the order of data/unknown options; no stage identifier
is `run`, so the verb is reserved rather than ambiguous. It is a
first-layer noun **in addition to** `executor` / `plugin` (ADR-011 amendment 2026-09-18). The runner
is resolved by entry identity (task 0178): a **checkout entry** — the source marker
`apps/cli/src/stage.ts` exists and the real package root is that checkout's `apps/cli` — always
executes the checked-in source runner, so a divergent copy staged under `apps/cli/plugins/` (a
gitignored artifact) is never loaded and editing the runner takes effect without restaging; an
**installed entry** keeps its own package-shipped runner regardless of cwd, and the module-anchored
source fallback applies only to a genuine checkout whose package copy is missing. Runner and sidecar
resolution, and the delegated stage names, are in §7.

### 1.9 `store` — shipped (tasks 0206, 0208–0210)

`kk store migrate [--db <path>]` brings the kk SQLite store's schema up to date. It is the first verb
of the first-layer `store` noun, alongside `executor` / `plugin` / `stage`. It resolves the database
path as explicit `--db` → `store.db_path` in the kk config → `.works/kk.db` (a leading `~` expands; a
relative path resolves against cwd; the parent directory is created), applies every unjournaled
migration from `packages/kk-store`'s append-only `KK_MIGRATIONS` list, and prints
`{"db": <path>, "applied": <n>}`. It is **idempotent** — a second run against the same database
reports `applied: 0` from the `__kk_store_migrations` journal, taking no write lock. A failure exits 1
with `kk.store.migrate.failed: <cause>` (a `CommanderError` `main()` maps to the exit code).

The store opens WAL (`PRAGMA journal_mode = WAL`) and `busy_timeout = 30000` on every open, and a
failed migration closes the adapter before rethrowing, so a rejected open never leaks the handle.
`packages/kk-store/src/db.ts` owns that sequence; the noun owns only path resolution and the printed
shape. The schema is created from `defineTable(...).createTableSql`, so there is no hand-written DDL
to drift — see §4 for the package surface and `.spur/rules/boundary/dao-boundary.yaml` for the
ts-db/drizzle confinement rules.

`kk lock acquire --name <lock> --run <id> [--ttl <ms>] [--db <path>]` takes the named
single-flight lock through `LocksDao.acquire` and prints `{"acquired":true}`, or
`{"skipped":"locked","holder":<run>}` — **both exit 0**: a skip is the scheduler's normal overlap
answer, not a failure, and stdout is the lock contract the workflow's guard reads. The claim is
re-entrant for the same `--run`, and a claim older than its recorded TTL is stolen, which is what
covers a crashed holder. `--ttl` defaults to `7200000` (2 h: the observed 20261006 collection ran
~32 min); `kk-collect` pins `--ttl 21600000` so a run is never overtaken mid-collect.
`kk lock release --name <lock> --run <id>` frees the lock **iff** that run still owns it and
prints `{released}` (`false` when the claim was already stolen or released). Failure exits 1 with
`kk.store.lock.failed: <cause>` — the flag/default/JSON/exit contract is route-independent.

Both verbs come from the single registrar `registerLockCommand(parent, hidden)` in
`apps/cli/src/commands/lock.ts`: `kk lock` registers it visibly and the hidden legacy `kk store lock`
group registers the same verbs over the same SQLite engines (A22 R3). `store lock …` keeps working —
`kk-collect` still shells it — but it is not listed in `kk store --help` and never prints a
deprecation line into machine output.

`kk store ingest --run <id> --in <Doc[].json> --new-ids <path> [--db <path>]` is the collector's
write path: it validates the input against `DocListSchema`, records the run's `collect_runs` row
(`start` → `finish` with the counts, `source_counts` derived from the blended docs'
`metadata.sources[].file` so per-plugin attribution is queryable), upserts through
`ItemsDao.upsertDocs` (one batch, so a rejected write stores nothing) and prints
`{inserted, updated, unchanged}`. `--new-ids` receives
the ids the next label pass must decide: the inserted ids plus the already-stored ids whose content
changed (whose `labels` rows the upsert deleted in the same batch). The DAO reports only the
inserted half, so the invalidated half is derived from the stored `title`/`body` **before** the
upsert — the two fields `content_hash` covers. Failure exits 1 with `kk.store.ingest.failed: <cause>`
and writes no `--new-ids` file.

**The typed item facts and the story key (task 0227, G32 D2/D5).** Ingest moves the deterministic
facts the four dimension scores are pure functions of out of `metadata_json` into typed `items`
columns: `engagement` (the largest finite number in `metadata.engagement`, mirroring the plugin's
`maxEngagement`), `body_chars` (`[...body].length`, counted in code points), `source_tier`
(`curated` for `aihot`, `community` for `rss`/`hackernews`, else `other` — the source-tier bases of
`IMPORTANCE_BASE`), `lang` (`metadata.lang`, else `zh` for a CJK-ideograph title, else `en` for a
Latin one, else NULL) and `domain` (`new URL(canonical_url).hostname`, lowercased, `www.` stripped,
NULL on a parse failure). `itemFacts(doc)` in `packages/kk-store/src/facts.ts` is the one derivation;
ingest fills the columns for every inserted or updated item (an unchanged item is not rewritten —
`content_hash` does not cover metadata), and `ItemsDao.backfillFacts` recomputes them for every row.

The same batch assigns each **inserted** item a `story_id`: the same event under two URLs shares one
story, so tomorrow's selection dedup can drop it. `storyIdFor(title, candidates, threshold)` in
`packages/kk-store/src/story.ts` tokenizes the title — NFKC + lowercase, a trailing outlet suffix
after ` - ` / ` | ` / `｜` / ` — ` dropped when it is ≤ 30 characters, punctuation/symbols removed,
CJK runs as character bigrams and Latin/digit runs as words — and takes the candidate with the best
token Jaccard at `>= threshold` (ties → earliest `first_seen_at`, then smallest `id`). Candidates are
the items inside `story.windowHours` of `now` plus the docs preceding it in the same batch; a story's
id is its earliest member's id, a `null` match makes the item its own story, and an existing item
keeps the `story_id` it has (a later item never re-roots a story). This is deliberately NOT the
plugin's whole-string character-bigram `titleSimilarity`, which over-merges unrelated English titles.

`kk store backfill-facts [--db <path>]` (task 0227 R4) recomputes the facts for every item and then
the `story_id` in `first_seen_at, id` order, clustering each item only against EARLIER items inside
the window, so clustering stays causal and the earliest member keeps the root. It prints `{updated}`,
the count of rows whose values actually changed, and is **idempotent** — a second run prints
`updated: 0`. Failure exits 1 with `kk.store.backfill-facts.failed: <cause>`.

`kk store label --run <id> --new-ids <path> [--maker <name>] [--mode heuristic|decision]
[--db <path>]` is the labelling pass over the ids the last `ingest` filed: the inserted items plus
the already-stored items whose content changed. Every listed id gets **one observation per (decision,
maker)** (task 0226): the row key is `(item_id, decision_id, maker, run_id)`, so a second maker never
overwrites the first and a rerun of the same run updates in place. Each row carries the mapped
`value` (`score` for the 0–5 dimensions), `maker`, `source` (`heuristic` | `model` | `default`),
`confidence` — the verdict's `HIGH | MEDIUM | LOW` level, never `null` for a row this pass writes —
`run_id` (the `--run` value every row carries), `labeled_at`, and the **raw evidence** the verdict
alone used to drop: `raw_value` (the answer verbatim, before vocabulary mapping), `raw_confidence`
(the model's own 0–1 payload), `reason`, `duration_ms`, `catalog_version` (the catalog's `version`,
`'unknown'` when it cannot be read) and `content_hash` (the item's hash when the answer was made, so
an edit never orphans it). A heuristic annotation is always recorded as its own maker `heuristic`
with `source: heuristic` and `raw_confidence NULL` — whether or not the item was routed — because it
is the baseline every backtest compares a model against. An id the store does not hold is skipped
rather than failing the pass.

`kk store label --replay <selector> --maker <name> [--decisions <ids>] [--window <duration>]
[--db <path>]` re-labels a HISTORICAL pool with another maker (task 0226 R6): the selector is exactly
one of `topic:<profile>` (the profile's pool, compiled exactly as `extract` compiles it, with no
exclusion), `run:<collect-run-id>` (`items.first_seen_run` or `last_seen_run`) or
`since:<n><s|m|h|d>` (`first_seen_at` within the window). Every selected item is routed in decision
mode for the selected decisions (default: the whole catalog) and **only** the maker's observations are
written — no heuristic row, and no other maker's row is created, updated or deleted — under the run id
`replay-<epoch-ms>`. stdout is `{replayed, consults, consultMs, run}`; a selector matching 0 items
prints `replayed: 0` and exits 0. `--replay` is mutually exclusive with `--new-ids` and requires
`--maker`; either violation exits 1.

Labelling is **heuristic-first**. The **eight** decisions come from `plugins/kk/decisions/kk-items.yaml`,
registered through `decisions.paths` in `.spur/config.yaml` and served by `spur decision run`:
`kk-item-category` (MECE choice, fallback `non-ai`), `kk-item-quality|importance|urgency|impact`
(0–5 score rubrics, fallback `2`), and the three judgment decisions added by task 0229 —
`kk-item-china-politics` (0–3, fallback `3`), `kk-item-sensitivity` (0–3, fallback `1`) and
`kk-item-audience` (choice `general | practitioner | researcher`, fallback `general`). `LABEL_DECISIONS`
in `apps/cli/src/commands/store.ts` is the ONE table they live in: it carries each id's `kind` and its
choice vocabulary or level count, and `decisionValue` validates every answer against its own entry (a
choice label must be in vocabulary; a score decision answers a position on the rubric's level axis
in `[0, levels-1]`, and kk stores `String(Math.round(score))` as `value` while `raw_value` keeps the
exact answer; out-of-range positions and non-numbers are refused and counted under `refused: {"<decision>@<maker>": n}`, task 0240). The keyword heuristic stays the plugin's: `kk store label` calls
`kk executor run episode-plan-gen` with `EPISODE_PLAN_MODE=label`, which annotates **every** input Doc
(`metadata.category`, `metadata.scores`, `metadata.needs_model`) with no cap, dedup or filter, so
`apps/cli` imports no plugin source. In `heuristic` mode (the default) only items the heuristic files
`non-ai` while seeing an AI signal are routed to `spur decision run <id> --param title=… --param
source=… --evidence <body file> [--maker <maker>] --json` (inheriting `.spur/config.yaml` `decisions.maker` unless `--maker` is explicitly passed); `--mode decision` routes every item. The heuristic's
five keep that routing; the three judgment decisions have no heuristic signal, so they are consulted
for **every** labelled item in both modes and their consults count in `consults`/`consultMs`. Before
consulting, the **china-politics keyword prefilter** (0229 R4) scans the title plus the first 200
characters of the body, case-insensitively, for `store.labels.china_politics_terms`: on a hit it
writes a `kk-item-china-politics` observation with maker `keyword` (never `heuristic`), source
`heuristic`, value `3` and reason `keyword:<term>`, and the model is STILL consulted so a backtest
keeps both rows. A result
with `source: default` (`no-backend`, `timeout`, `error`, `low-confidence`), an unparseable payload, an
out-of-vocabulary value or a spawn failure stores the **heuristic value** with `source: default`: the
pass exits 0 and a collect run never fails on labels. stdout is `{verdict, confidence, labeled,
model, fallback, consults, consultMs}` — `model` counts the `source: model` rows and `fallback` the
`source: default` ones, while `labeled` is every row written (the heuristic baseline included).
`consults` counts the `spur decision run` invocations the pass attempted and `consultMs` sums their
reported `durationMs` (the decision backend does not report token usage), both observable without
parsing `decision_logs`. The scratch under `<new-ids dir>/label/` (beside the store database for a
replay) is removed on the way out. Usage errors (a missing or malformed `--new-ids`, an unknown
`--mode`, a malformed replay selector, a missing `--maker`) exit 1 with
`kk.store.label.failed: <cause>`.

**The label config and the current label (task 0226 R3/R4).** `packages/kk-store/src/config.ts` owns
the ONE kk config reader, `readStoreConfig(configFile?)`, returning
`StoreConfig { dbPath?, labels: { priority, decisionPriority, minConfidence }, story: { threshold, windowHours } }`;
`readStoreDbPath`
(and, in turn, 0227's story keys and 0229's profile gate) reads through it. The keys are
`store.labels.priority` (maker names, best first; default `['*', 'heuristic']`, where `'*'` matches
any maker at its own position), `store.labels.decisions.<id>.priority` (optional; replaces the global
list for that decision id — `kk-item-china-politics` defaults to `['keyword', '*', 'heuristic']` when
the operator sets none, so the keyword hit is a hard floor and a non-hit falls through to the model),
`store.labels.china_politics_terms` (a non-empty string array, default the built-in top-leader and
central-institution list — `习近平`, `总书记`, `中共中央`, `政治局`, `中南海`, `党中央`, `Xi Jinping`,
`Politburo`, `Zhongnanhai`; never a generic term like `中国`/`China`/`Beijing`, because the prefilter
only ADDS exclusions) and `store.labels.min_confidence` (a number in `[0, 1]`, default `0.8` —
ADR-125's threshold, which is why the item-label catalog's own `minConfidence` is now `0`: every raw
answer is accepted and stored, and the threshold gates only which stored observation is current). A
missing, unreadable or unparseable file yields the defaults; a key that is PRESENT with the wrong type
or outside its domain throws `StoreConfigInvalidError` naming it, because a silently defaulted
priority or threshold changes which labels are current and therefore which items a topic pool holds.
The **story keys** (task 0227 R3) are `store.story.threshold` (the Jaccard a candidate must reach, a
number in `(0, 1]`, default `0.6`) and `store.story.window_hours` (the candidate window, a positive
integer, default `72`); ingest and `backfill-facts` read them through the same
`readStoreConfig`, under the same fail-loud rule.

One CTE builder, `labelsCurrentSql(policy)` in `packages/kk-store/src/dao/labels.ts`, defines
`labels_current` — one current row per `(item_id, decision_id)` — and every read uses it:
`ItemsDao.selectByProfile`'s joins, `ItemsDao.labelsFor` and `LabelsDao.currentFor(itemIds, policy)`.
A row is eligible when its `content_hash` is the item's CURRENT hash, its `source` is not `'default'`
(a degraded row is not a label), a `source 'model'` row clears `min_confidence`, its maker is in the
effective priority (or matched by `'*'`), and — for a `run_id` starting `replay-` — its maker is
listed BY NAME: `'*'` never admits a replay row, and an unlisted maker is filtered out in `WHERE`
rather than ranked last. Kept rows rank by priority position, then the latest `labeled_at`, then the
greatest `run_id`; row 1 wins. So under the default policy a model answer outranks the heuristic
baseline it was compared against, a below-threshold model answer is stored but never current (and
where it is the only row, the pair simply has no current label — fail-closed), a migrated v1 model
row and a new model row with NULL `raw_confidence` are both non-current (while a migrated heuristic
row at the same content hash remains current), and no replay can
displace production selection. There is no SQL VIEW (`bun:sqlite` ships window functions).

**The confidence level (G31 R14, task 0213).** Every verdict this surface emits carries exactly one
level from the closed `HIGH | MEDIUM | LOW` enum — the same vocabulary the judge-verdict gates and the
`verification-confidence-level` rule use, in one contract rather than a fourth mechanism. The model's
numeric 0–1 confidence is **mapped into the enum at this boundary** (`labels.confidence`) while the
payload itself is kept beside it in `raw_confidence` (task 0226, so a backtest can re-rank without a
new model call): `HIGH` at `>= 0.8`, `MEDIUM` at `>= 0.5`, `LOW` below it, and `LOW` for a
keyword-heuristic row, a degraded `source: default` row or a model answer whose payload carried no
number — only a model answer with evidence can earn more than `LOW`, and a missing level is never
stored as `null` or silently defaulted. `min_confidence` is NOT part of this mapping: it gates
`labels_current` eligibility only. `labelConfidence(source, confidence)` is that mapping and `verdictConfidence(levels)` is
the pass's own level (the weakest among its rows, `LOW` for an empty pass), both exported by
`@gobing-ai/kk-store`. `labels.confidence` is declared `text` and holds exactly one of
`HIGH | MEDIUM | LOW` — migration `0002` adds it as `TEXT` so a migrated database converges on a
fresh one — and `labels.score` remains the separate 0–5 rubric value. The pass prints its verdict as `verdict: PASS` plus that level, which is what the
`kk-collect` `label` guard reads — through the same confidence-aware `jq` filter the judge gates use,
so a `PASS` whose level is missing or outside the enum reads as `PASS!`, is refused by name
(`kk-collect.label.confidence-refused: verdict '<v>' carries confidence '<c>', not HIGH|MEDIUM|LOW`)
and fails the run through `release-failed` instead of being read as a pass. Proof:
`plugins/kk/tests/verdict-confidence.test.ts` executes the REAL guard string over fixture verdict
lines (artifact `.spur/run/verdict-confidence/summary.json`); `apps/cli/tests/store-label.test.ts`
proves the producer half against a temp store.

`kk store extract --topic <t> [--window 24h] [--limit <n>] [--include-selected]
--out <Doc[].json> [--db <path>]` is the read path an episode workflow starts from — the answer to
"which stored items belong in this topic's pool?". The topic names a **profile file**
(`plugins/kk/decisions/extract/<topic>.yaml`), resolved from the working checkout first and the
installed package's own checkout second, exactly as `kk schedule render` resolves its templates;
the CLI never spawns a plugin, so extraction neither ingests nor labels (§1.5 stays the only plugin
entry).

The profile shape is `{ topic, where, order, limit }`:

```yaml
topic: ai-news
where:
  kk-item-category: { in: [ai-news, ai-industry] }
  kk-item-quality: { gte: 2 }
  kk-item-importance: { gte: 3 }
  kk-item-china-politics: { lte: 1 }
order: [kk-item-urgency desc, kk-item-impact desc, first_seen_at desc]
```

`where` keys are decision ids from the kk item-label catalog (an unknown top-level key, an unknown
decision id, a malformed predicate or a non-positive `limit` exits 1 with
`kk.store.profile.invalid: <cause>`); each predicate is `{in: [...]}` or `{gte|gte: n}`. `order`
entries are `"<decision-id> asc|desc"` or `"first_seen_at asc|desc"`, most significant first, with
`i.id ASC` as the final tiebreak. `limit` defaults to the profile's own cap, or the episode cap
(20) when the profile omits it; `--limit` overrides both.

`packages/kk-store/src/profile.ts` owns `parseProfile` / `compileProfile`;
`ItemsDao.selectByProfile` owns the SQL as one parameterized statement: one `labels_current` join per
`where` key (the CTE above, so only the CURRENT observation for each decision participates),
`i.first_seen_at >= now - --window`, and a topic-scoped story exclusion,
`NOT EXISTS (SELECT 1 FROM selections s WHERE s.topic = ? AND s.story_id = i.story_id AND
s.status IN ('selected','published'))` — so no SQL leaves `packages/kk-store`. The exclusion is
ALWAYS on, scoped to `--topic` (task 0228 R4): an item planned for a run, published or not, never
re-enters that topic's pool, and a story re-reported under a new URL is excluded too. A second topic
is unaffected — one item may serve several. `--include-selected` is the explicit opt-out. A decision
named only by `order` left-joins (an item without that label is sorted, not dropped), while a `where`
decision with no `labels` row excludes the item: its join **is** the predicate. That is the point of
the shipping `kk-item-china-politics: { lte: 1 }` gate (0229 R5): an item with no current
china-politics answer — the model backend was down, or its answer was below threshold — is EXCLUDED
(fail-closed), so the pool shrinks toward safety instead of admitting an unjudged item. Level 0 and 1
clear the gate; level 2, 3 and a keyword-floor hit do not, while the Chinese-AI-industry items the
decision scores 0 stay eligible.

The pool is written to `--out` as `Doc[]` in the fan-in `blended.json` shape — `id`, `title`, `body`,
`sourceUri`, `mediaType` and the stored metadata plus `metadata.labels: { <decision-id>: value }`
(every stored answer for the item) — so `episode-plan-gen` consumes either file unchanged. stdout is
`{count}` and the store is only read (no `items`/`labels`/`collect_runs` writes). An **empty pool**
writes `[]`, prints `{"count":0}` and still exits 0: the workflow conditions on `count`, not on the
exit code. `--window` must be `'<n>s|m|h|d'` and `--limit` a positive integer; every other failure
(an unknown topic, a bad window or limit, an unreadable database) exits 1 with
`kk.store.extract.failed: <cause>`.

**The topic-scoped selection ledger (task 0228).** The dedup ledger is the `selections` table —
`(topic, item_id, run_id)` identity plus `story_id`, `workflow`, `rank`, `reason`, `status`
(`selected` → `published` | `dropped`), `selected_at`, `published_at` — replacing `episode_usage`
(ADR-030 amendment, 0225). Three verbs own it:

- `kk store select --topic <t> --workflow <w> --run <id> --in <path> [--db <path>]` records the
  run's planned set as `selected` rows. `--in` is a `Doc[]` or an object whose `metadata.docs` is one
  (the QC candidates file); any other shape fails loud. One row per distinct doc id, `rank` the
  1-based input order, `story_id` the item's stored story key, `reason` NULL in voice2. A doc id the
  store does not hold fails loud naming it and writes **nothing** (no partial ledger); an empty list
  writes nothing and prints `{selected: 0}`. Idempotent per `(topic, item_id, run_id)` — a repeat
  writes nothing and never resets a promoted row. stdout is `{selected}`; failures exit 1 with
  `kk.store.select.failed: <cause>`.
- `kk store mark-published --topic <t> --run <id> [--in <path>] [--db <path>]` promotes that run's
  `selected` rows to `published` and stamps `published_at`; `--in` narrows the promotion to the
  listed ids. A run with nothing to promote prints `{published: 0}` and exits 0. Failures exit 1 with
  `kk.store.mark-published.failed: <cause>`.
- `kk store release --run <id> [--topic <t>] [--db <path>]` moves that run's `selected` rows to
  `dropped`, returning its items to the pool — the operator's tool for a failed run. `published` rows
  are never touched: an aired episode must not silently re-admit. stdout is `{released}`; failures
  exit 1 with `kk.store.release.failed: <cause>`.

`kk daily prepare --workflow <w>` additionally names, on stderr, every other run still holding
`selected` rows for that workflow, each with the `kk store release --run <id>` that frees it (R7).
The check is read-only, and a store that is missing or fails to open prints nothing and never fails
`prepare`.

### 1.10 `ledger` — shipped (task 0207)

`kk ledger` maintains a per-workflow run ledger at `<works-dir>/<workflow>/ledger.md` (default
`--works-dir .works`), rendered from `spur workflow trace --json` so every workflow — including
future ones — gets authoritative timing and token figures without kk-owned timing files.

| Arg / Option | Type | Required | Default | Description |
| -------------- | ------ | ---------- | --------- | ------------- |
| `--workflow <name>` | string | yes | — | Workflow name; selects `<works-dir>/<name>/ledger.md` |
| `--run <run-id>` | string | yes (`append`) | — | Run id to render |
| `--works-dir <dir>` | string | no | `.works` | Ledger root directory |
| `--work-dir <dir>` | string | no | — | Workflow `work_dir`; source of `<node>.summary.txt` result cells |

- `sync` runs at the first node and writes each run's section; the final-node `append` sees its own
  run still `running` and exits 1 (see `docs/design/kk-collect-and-daily-voice2.md` §7).
- Section shape: `## <startedAt UTC minute> · run <id first 8> · <status> · <XhYmZs> ·
  tokens: <in>/<out> (+<n> unknown)` plus an `<!-- run:<full id> -->` marker. The marker is the
  idempotency key: a run whose marker is already present is never appended twice, and `sync` skips
  it. The file is append-only; `sync` writes at most once per invocation and reports the run ids it
  added in `appended` (`[]` when nothing changed).
- The step table (`| Step | Status | Duration | Tokens in/out | Result |`) groups `events[]`
  entries with `kind: "action"` by `node`, in first-seen order; a node's several actions collapse
  into one row (durations summed), and the row is `failed` when any of its actions failed.
- Tokens are only ever reported figures: a step with no `agent.run` action renders `—`, an agent
  step sums `cost.exact.totals.{inputTokens,outputTokens}`, and any agent action whose `cost.exact`
  is null (including `cost.estimated`-only rows) renders `unknown` for the whole step and increments
  the header's unknown count. Estimated usage is never rendered.
- Result cells: the first line of `<work-dir>/<node>.summary.txt` when it exists (`sync`: newest missing run
  only), else the first failing action's `error`, else `ok`; pipes escaped, cell cut to 120 chars.
- Failures exit 1 with `kk.ledger.<reason>` and leave the ledger untouched: `run.running`,
  `trace.not-found`, `trace.spawn-failed`, `trace.invalid`, `list.invalid`, `write.failed`, and
  `workflow.invalid` for a `--workflow` that is not a flat file stem (`[A-Za-z0-9][A-Za-z0-9._-]*`;
  refused before any spawn, so the ledger can never land outside `--works-dir`).
  `KK_SPUR_BIN` overrides the `spur` binary (tests, non-PATH installs).

### 1.11 `schedule` — shipped (task 0208)

`kk schedule render <schedule> --platform launchd|cron [--repo <dir>]` prints the scheduling
artifact for a shipped schedule from `plugins/kk/schedules/`, with `{{repo}}` bound to the `--repo`
checkout (default: cwd) and `{{home}}` to the operator's home.
**Installing it is an operator action** — kk never writes a crontab or a `LaunchAgents` plist, so the
command's only side effect is the text it prints (`plugins/kk/README.md` §Schedule documents the
install lines).

`spur serve` **hosts the scheduler**: the `.spur/config.yaml` `bootstrap.scheduler` jobs (the daily
`kk-daily-ai-voice` tick) are enqueued by the job worker that lives inside the server, so the server
itself is what must be kept alive (2026-10-12). `kk-serve` is that keepalive (task 0265).

Both artifacts also bind `TYPESAFE_API_KEY` from the environment `render` runs in (2026-10-12).
The scheduled workflow labels its items through `kk store label`, which consults the `typesafe`
decision maker for `kk-item-china-politics` / `-sensitivity` / `-audience`; spur keeps that
credential env-only, and an OS-scheduled job inherits nothing from the operator's shell. Without it
every one of those labels degrades to its fail-closed default (`kk-item-china-politics` = 3), the
`ai-news` extract profile's `lte: 1` gate excludes the whole day, and the next daily tick finds an
empty pool and closes as no-content. An unset or empty value renders as the empty string, which
spur reads as "not set", so a keyless render still produces a valid artifact; in the plist the
value is XML-escaped (`&`/`<`/`>`), because one raw `&` makes `launchctl bootstrap` refuse the file.

| Schedule | Platform | Rendered artifact |
| ---------- | ---------- | ------------------ |
| `kk-collect` | `launchd` | plist for `ai.gobing.kk-collect` (`launchd.plist.tmpl`): `StartCalendarInterval` 04:00/10:00/16:00/22:00 local (6 h; sleep coalesces missed fires to one run at wake), `ProgramArguments` = `spur workflow run plugins/kk/workflows/kk-collect.yaml`, `WorkingDirectory` = `--repo`, `EnvironmentVariables` = `PATH` + `TYPESAFE_API_KEY`, stdout+stderr = `<repo>/.works/kk-collect/launchd.log` |
| `kk-collect` | `cron` | `0 4,10,16,22 * * * cd <repo> && TYPESAFE_API_KEY='<key>' spur workflow run plugins/kk/workflows/kk-collect.yaml >> <repo>/.works/kk-collect/launchd.log 2>&1` |
| `kk-serve` | `launchd` | plist for `ai.gobing.spur-serve` (`kk-serve.launchd.plist.tmpl`): `RunAtLoad` + `KeepAlive` true, `ThrottleInterval` 10, `ProgramArguments` = `spur serve --cwd <repo> --host 127.0.0.1 --port 3003 --no-open`, `WorkingDirectory` = `--repo`, `EnvironmentVariables` = `PATH` + `TYPESAFE_API_KEY`, stdout+stderr = `<repo>/.works/spur-serve/serve.log` |

`kk-serve` is **launchd only**: cron has no keepalive semantics, so `--platform cron` for it exits 1
with `schedule 'kk-serve' has no cron template (expected launchd)` and prints nothing (task 0265 R3);
`kk-collect` keeps both platforms. `kk-serve` freezes host/port as template constants and keeps the
hand plist's `Label`, so re-rendering replaces the installed agent in place.

Templates resolve from `--repo`'s own `plugins/kk/schedules/`, falling back to the running
package's copy, so a checkout without the templates still renders. An unknown schedule or platform
exits 1 with `kk.schedule.render.failed: <cause>` and prints nothing — a typo must never emit a
partial schedule.

### 1.12 `bot` — shipped (A22; tasks 0276, 0277)

Named local browser sessions over the fixed default profile root
`~/.config/kk/browser-profiles` (derived from the OS home directory; no ambient env override
redirects it — A22 R1). The lifecycle lives in `packages/publish-harness/src/{bot,bot-fs,bot-transaction,profile-lease}.ts`
and the CLI registrar `apps/cli/src/commands/bot.ts`; the browser half of the harness is imported
lazily inside the actions, so `--help`, `bot list` and `plugin status` never need installed browser
binaries.

```text
kk bot list                        # one tab-separated `name<TAB>cached<TAB>defaultUrl|unknown` row per profile
kk bot login <url> --save <bot>    # headed login; a matched channel adapter saves site-verified
                                   # evidence without a prompt, otherwise operator confirmation (0277)
kk bot logout <bot>                # deletes that bot's contained profile; prints `<name>\tremoved|absent`
kk bot open <bot> [--login]        # reopens the saved page headed; prints `<name>\tclosed` on close
```

- `list` enumerates direct, non-symlink profile directories, including legacy directories listed
  with `unknown`; an absent root is an empty success. It never inspects cookie databases or
  launches a browser.
- `login` validates the name (`[A-Za-z0-9][A-Za-z0-9_-]{0,63}`) and URL (http/https only, no
  embedded credentials, fragments stripped) before any filesystem or browser effect, works on an
  isolated staging profile under `~/.config/kk/browser-transactions/<name>-<uuid>/stage` while
  holding the shared lease, and promotes atomically via same-filesystem rename with a restorable
  backup. Generic sessions persist only origin+pathname as `defaultUrl`; the supplied URL is
  navigation input and is never echoed into failures or logs.
- `logout` deletes only the owned, inactive, contained profile directory behind the shared lease
  (`~/.config/kk/browser-leases/`); an absent bot is idempotent success; symlinked profiles are
  refused, never followed.
- `open` reuses the saved default URL and profile headed and stays until the context closes; it
  never invents a session for a missing, legacy or corrupt profile; `--login` completes the same
  login/save transaction and then reopens.
- Channel binding (0277): a publish plugin may declare `browserSession {profileName, homeUrl?}`.
  Selection order is the saved `pluginName` (an unavailable or non-session adapter refuses rather
  than falling back), then a unique declared `profileName` equal to the bot name, then a unique
  literal `homeUrl` origin; ambiguity refuses and no match stays generic. A bound adapter runs the
  plugin's own `login` in bot mode (the parent supplies `--url`, so the adapter may write only
  within the leased staging profile) and persists only the verdict's canonical, plugin-owned
  `defaultUrl` — never the operator's URL, its query included.
- Exit contract: validation/usage failures print `kk.bot.failed: <detail>` to stderr and exit 2;
  operational failures exit 1 with the same contract line (`BotError.code === 'usage'` maps to 2).
  Profiles use owner-only 0700 directories and 0600 metadata (`bot.json`: schemaVersion,
  defaultUrl, optional pluginName, authenticationEvidence).
- Packaging: `playwright` is an explicit runtime dependency of `@gobing-ai/publish-harness`
  (catalog pin) and is excluded from the CLI bundle (`--external playwright`), so the installed
  CLI's help/list/status paths run without browser binaries.

Channel descriptor integration and site-verified login evidence are task 0277; the caller/recipe
migration review is task 0278.

## 2. Configuration keys

Product file: `$KK_CONFIG` (default `~/.config/kk/config.yaml`). Spur harness config stays under
`.spur/config.yaml`.

| Key | Type | Default | Description |
| ----- | ------ | --------- | ------------- |
| `works_dir` | string | `$HOME/.config/kk/works` | C4 topic workspace root (`KK_WORKS_DIR` wins) |
| `workflows_dir` | string | `$HOME/.config/kk/workflows` | User-override root for workflow YAMLs (`KK_WORKFLOWS_DIR` wins); resolution falls back: this → `KK_WORKFLOWS_SOURCE` → bun global → npm global → kk package root → repo checkout |
| `defaults.maxResults` | int | `8` | STORM ingest cap |
| `defaults.fixture` | bool | `false` | STORM live vs fixture |
| `plugins.<collection>.<name>.env` | map of scalars | — | Injected into that plugin's process env at `spawnPluginEntry`. Real env vars win (`flag > env > config > compiled default`). Collection names: `ingestions` / `generations` / `publishings`. Missing file or missing key → no extra env. Empty-string values are skipped. |

## 3. Environment variables

| Var | Required | Description |
| ----- | ---------- | ------------- |
| `NODE_ENV` | no | Set to `test` by workspace test scripts |
| `POSTSURFING_BIN` | no (surfdash-pub) | Path to the `postsurfing` binary the Surfdash transport invokes (default: on PATH) |
| `ZENN_REPO` | yes (zenn-pub) | Zenn/GitHub repository path the Zenn transport publishes into (`npx --yes --package zenn-cli@0.5.4 zenn new:article` + pathspec-scoped `git add/commit -- articles/<slug>.md` + `git push origin main`). `npx <name>` resolves the npm package *named* `<name>`; package `zenn` was unpublished 2021-04-20, so `--package` names the real `zenn-cli` explicitly |
| `ZENN_USERNAME` | no (zenn-pub) | Zenn account name for the reported article URL (`https://zenn.dev/<user>/articles/<slug>`). Unset → `url` is omitted and `message` names this var, because `https://zenn.dev/articles/<slug>` (no username segment) 404s |
| `QIITA_TOKEN` | yes (qiita-pub) | Qiita API v2 token; sent as `Authorization: Bearer <token>` on `POST /api/v2/items` |
| `KNOWLEDGE_KIT_PUBLISH_TRANSPORT` | no | `fake` selects `FakeFileCliTransport` instead of the real transport — the offline harness switch, identical across `surfdash-pub` / `zenn-pub` / `qiita-pub` |
| `KNOWLEDGE_KIT_PROJECT_ROOT` | no | Project root the executor hands to every spawned plugin (default: the `kk` process cwd). `content-gen`'s STORM stages pass it as `spur agent run --cwd` so agents anchor to the project, not the plugin package dir |
| `KK_PLUGIN_PATH` | no | `path.delimiter`-separated (`:` POSIX / `;` win32) extra plugin roots to union with the default discovery roots; relative entries resolve against the cwd and returned roots are absolute (ADR-012); overridden by `--plugins-root` |
| `KK_CONFIG` | no | Path to the operator YAML (`works_dir`, workflow defaults, `plugins.<collection>.<name>.env`). Default: `~/.config/kk/config.yaml` |
| `FIRECRAWL_API_KEY` | yes (web-search live) | Bearer token for the live Firecrawl client (task 0057; selected when `fixture` is absent/false) — unset → exit 1, no `--out` (fail loud) |
| `VOICEBOX_URL` | no (voice-gen) | Origin for Voicebox REST API (default: `http://127.0.0.1:17493`). Local origins (`127.0.0.1`/`localhost`/`::1`) are **auto-started** when not already healthy (0146): voice-gen spawns the server binary detached, polls `/health` for 30s (500ms interval, fixed defaults), logs stderr to `/tmp/voicebox-server.log`. Non-local URLs and a missing binary (`VOICEBOX_SERVER_BIN`, default `/Applications/Voicebox.app/Contents/MacOS/voicebox-server`; data dir `VOICEBOX_DATA_DIR`) are configuration errors — fail loud, never spawn |
| `DAILYNEWS_LANGUAGE` | no (dailynews-gen) | Broadcast language passed through `kk executor run`; `zh` (default) or `en` |
| `DAILYNEWS_TITLE` | no (dailynews-gen) | Optional broadcast title passed through `kk executor run` |
| `VOICEBOX_DEFAULT_PROFILE` | no (dailynews-gen/voice-gen/omni-voice-gen/gemini-tts) | Default profile name/ID when the news workflow or segment/doc omits profile |
| `VOICEBOX_TIMEOUT_MS` | no (voice-gen) | Per-request timeout in ms (default: `600000`) — bounds both the generation poll and every Voicebox HTTP call (`/health`, `/profiles`, `/generate`, `/history/<id>`, `/audio/<id>`, `/transcribe`) |
| `VOICEBOX_POLL_MS` | no (voice-gen) | Poll interval in ms (default: `1000`) |
| `VOICEBOX_ENGINE` | no (voice-gen) | TTS engine override when script/profile omit it (`qwen` default; `qwen_custom_voice` has no clone support) |
| `VOICE_GEN_FAIL_ON_QC` | no (voice-gen, omni-voice-gen, gemini-tts) | `true` fails generation when the QC audit fails (fidelity/duration/repetition); the daily workflow does **not** route on `metadata.qc.passed` — degradation-class audits publish warn-only and surface in the run report's `## 音频 QC` block (0140), while the credibility-damaging `repetition_detected` class is hard-failed upstream by 0139 R5a |
| — (per-segment verify) | no (voice-gen) | Unconditional post-generation check: each segment's audio is transcribed back and compared against the source text (`transcriptionFidelity`); below `TRANSCRIPTION_FIDELITY_FLOOR` (0.15) the segment is regenerated (≤2 retries) with a varied seed and halved `max_chunk_chars` (floor 100). Final attempt always accepted; the QC audit (which reuses the stored transcription) remains the backstop. Catches contiguous loop garbage the server's gap-based runaway detector misses (dogfood 2026-09-03) |
| `EPISODE_PLAN_MAX_ITEMS` | no (episode-plan-gen) | Caps selected episode items (default `20`); the daily workflow passes `plan_max_items` through |
| `EPISODE_PLAN_DATE` | no (episode-plan-gen) | Optional run date stamped into the plan Content metadata (`planDate`) |
| `EPISODE_PLAN_MODE` | no (episode-plan-gen) | Mode selector when the executor flag is unavailable: `plan` (default) or `filter`; precedence `--mode` flag > env > `plan`, unknown value → exit 1 naming both sources (0097 — the workflow's `quality-control-content` state sets `EPISODE_PLAN_MODE=filter` because `kk executor run` forwards only `--in`/`--out`) |
| `QC_CATEGORIES` | no (episode-plan-gen `--mode filter`) | Comma-list category allowlist for the quality controller (default `ai-news,ai-industry`); unknown category → exit 1 (fail loud) |
| `QC_MIN_QUALITY` / `QC_MIN_IMPORTANCE` / `QC_MIN_URGENCY` / `QC_MIN_IMPACT` | no (episode-plan-gen `--mode filter`) | Inclusive per-dimension minimums, integers 0–5 (defaults `2`/`3`/`2`/`1` — 0099 calibration from 0098 dogfood: 3/3/2/2 rejected 20/20 live candidates); non-integer or out-of-range → exit 1, never clamped |
| `QC_MIN_EPISODE_ITEMS` | no (episode-plan-gen `--mode filter`) | Episode floor (20261002, default `8`): when fewer docs survive the filter, rejects that failed ONLY the importance minimum (source-tier base — the softest dimension on a thin news day; quality/urgency/impact/category stay hard) backfill strongest-first (importance desc → planScore desc → plan order), each stamped `metadata.backfilled: true` and removed from the `.rejected.json` audit; best-effort when the eligible pool is short. Floor exceeds the spoken target because the prompt-layer 选题边界 drops policy items after this gate. Positive integer, non-integer or `0` → exit 1. Workflow pin: `qc_min_episode_items` (kk-daily-ai-voice) |
| `CONTENT_LANGUAGE` | no (content-gen) | Writing language directive for STORM outline/article/polish (`zh` = Simplified Chinese incl. title); the daily workflow passes `language` through |
| `KK_IMAGE_MAX_IMAGES` | no (image-gen) | Per-run image budget cap (compiled default `4`). Precedence `spec.maxImages` → this → default; non-integer or `< 1` → exit 1 naming the value |
| `KK_IMAGE_DRY_RUN` | no (image-gen) | `1` composes every prompt and selects the provider but spends nothing (`metadata.dryRun: true`). The illustration anchor-plan check still runs on this branch (0169) |
| `KK_IMAGE_PRESET_PATH` | no (image-gen) | `path.delimiter`-separated extra preset roots, lowest → highest after builtin → `~/.config/kk/image-presets` → `<KNOWLEDGE_KIT_PROJECT_ROOT>/.kk/image-presets` (ADR-012 root order); non-directory entries are skipped |
| `SURFDASH_ROOT` | no (surfdash-pub) | Surfdash checkout root; default derives from `POSTSURFING_BIN` (`<root>/scripts/<cli>`). The article markdown must land at `content/posts/articles/<locale>/<slug>/index.md` |
| `SURFDASH_LOCALE` | no (surfdash-pub) | Content locale directory for the published post (default `zh`) |
| `SURFDASH_AUTO_PUSH` | no (surfdash-pub) | `0` disables the post-publish deploy seam (git commit/push of the post path + live-URL poll); any other value or unset auto-pushes. Production deploys run from surfdash's `deploy.yml` on every push to `main` — without the seam the article 404s until a manual commit (dogfood 2026-09-12) |
| `SURFDASH_URL` | no (surfdash-pub) | Base URL for the live-URL poll and `url` in the Result (default `https://surfing.salty.vip`); article derived as `<base>/<locale>/posts/<slug>` |
| `VOICEBOX_MAX_CHUNK_CHARS` | no (voice-gen) | Max chunk characters (default: `800`, range 100–5000) |
| `VOICEBOX_CROSSFADE_MS` | no (voice-gen) | Crossfade duration in ms (default: `50`, range 0–500) |
| `VOICE_GEN_MP3` | no (voice-gen, omni-voice-gen, gemini-tts) | When `true`/`1`/`yes`/`on`, transcode sibling WAV to `<outStem>.mp3` with ffmpeg (`libmp3lame`); `metadata.mp3Path` is the absolute MP3. Default off. Missing ffmpeg or transcode failure → fail-loud, no `--out` |
| `VOICE_GEN_MAX_RUN_MS` | no (voice-gen, omni-voice-gen, gemini-tts) | Total render budget in ms, checked between segments (default: unset = unlimited); exceeded → fail loud before the next segment. Guard against a wedged TTS backend crawling for hours (voice-gen D14; omni-voice-gen D6) |
| `GEMINI_API_KEY` | yes (gemini-tts) | API key sent as `x-goog-api-key` on Gemini TTS and voice-create requests. Missing → exit 1 before any network call |
| `GOOGLE_BASE_URL` | no (gemini-tts) | Gemini API origin (default `https://generativelanguage.googleapis.com`) |
| `GEMINI_TTS_MODEL` | no (gemini-tts) | `gemini-3.8-flash-tts` (default) or `gemini-3.8-flash-lite-tts`; anything else exits 1 naming both |
| `GEMINI_TTS_PROFILES` | no (gemini-tts) | Path to the profile map (`name → {voice}`). Default is the plugin `profiles.json` placeholder |
| `GEMINI_TTS_ASR` | no (gemini-tts) | `off` omits transcription and leaves fidelity/repetition unmeasured; any other value or unset runs ASR |
| `GEMINI_TTS_ASR_MODEL` | no (gemini-tts) | Text model for verbatim transcription (default `gemini-3.8-flash`) |
| `GEMINI_TTS_MAX_ATTEMPTS` | no (gemini-tts) | Retry cap for 429, 5xx, and network errors (default 4) |
| `GEMINI_TTS_TIMEOUT_MS` | no (gemini-tts) | Per-request `AbortSignal.timeout` in ms (default `120000`) |
| `VOXCPM_MODEL` | no (voxcpm-tts) | VoxCPM model id or local snapshot dir (default `openbmb/VoxCPM2`); resolved and retained explicitly before load and checked against vendor exclusion |
| `VOXCPM_DEVICE` | no (voxcpm-tts) | `auto` (default), `cpu`, `cuda`, `mps`; an unavailable requested device fails |
| `VOXCPM_PROFILES_PATH` | no (voxcpm-tts) | Path to the frozen `profiles` registry (default `<plugin-root>/profiles.json`) |
| `OMNIVOICE_PROFILE_REGISTRY` | no (omni-voice-gen) | Path to the JSON profile registry (profile name → `{ref_audio, ref_text}` clone / `{prompt}` saved clone prompt / `{instruct}` voice design); default `<plugin>/profiles.json`. Unknown profile name → exit 1 naming the profile (D4) |
| `OMNIVOICE_MODEL` | no (omni-voice-gen) | HuggingFace model id loaded via `OmniVoice.from_pretrained` (default: `k2-fsa/OmniVoice`) |
| `OMNIVOICE_DEVICE` | no (omni-voice-gen) | Torch device map override (default: auto — CUDA > MPS > CPU) |
| `OMNIVOICE_SPEED` | no (omni-voice-gen) | Speech speed multiplier (default: `1.0`) |
| `OMNIVOICE_ASR_MODEL` | no (omni-voice-gen) | ASR model for the post-generation fidelity check (default: unset → omnivoice default whisper) |
| `MICROFEED_BASE_URL` | yes (podcast-pub) | Base URL for self-hosted microfeed REST API (e.g. `https://<instance>.workers.dev`) |
| `MICROFEED_API_KEY` | yes (podcast-pub) | microfeed named API key (`mf_…`) with write scope |
| `MICROFEED_TIMEOUT_MS` | no (podcast-pub) | Request / upload timeout in ms (default: `300000`) |
| `SUBSTACK_PUBLICATION_URL` | yes (substack-pub) | Publication the Substack editor URL is derived from: the URL without its trailing `/` or `/publish`, plus `/publish/post` (the bare route — Substack rewrites it to `/publish/post/<id>` on autosave; the legacy `/publish/post/new` never rewrites, measured 0193). Unset, blank or non-`https:` → `ok: false` naming this var before any browser opens (there is no default publication — `substack.com/new` picks an arbitrary one). A per-run `options.publicationUrl` (or the CLI's `--publication <url>`) wins |
| `KK_BROWSER_PROFILE_DIR` | no (x-pub `article`, xhs-pub, juejin-pub, infoq-pub, substack-pub, weibo-pub, jike-pub, csdn-pub, cnblogs-pub, sspai-pub, xiaoyuzhou-pub, shipinhao-pub, bilibili-pub) | Shared fallback browser profile dir for the `script` browser transports; a per-channel override wins (`X_PROFILE_DIR` / `XHS_PROFILE_DIR` / `JUEJIN_PROFILE_DIR` / `INFOQ_PROFILE_DIR` / `SUBSTACK_PROFILE_DIR` / `WEIBO_PROFILE_DIR` / `JIKE_PROFILE_DIR` / `CSDN_PROFILE_DIR` / `CNBLOGS_PROFILE_DIR` / `SSPAI_PROFILE_DIR` / `XYZF_PROFILE_DIR` / `SHP_PROFILE_DIR` / `BILIBILI_PROFILE_DIR`). Tiers are resolved by `resolveChannelProfileDir(channel, override)` (`@gobing-ai/publish-harness/browser`, ADR-027); blank values count as unset. Default `~/.config/kk/browser-profiles/<channel>` (`resolveBrowserProfileDir`) |
| `KK_BROWSER_CHANNEL` | no (every browser publish channel) | Playwright channel for `kkBrowserLauncher` (0214): `chromium` (default; full Chromium, also in headless mode) or `chrome` (installed Google Chrome). Blank counts as unset. Headed login and headless check then share one cookie store; Playwright's default headless shell can't read a headed login's cookies |

### Request timeouts

Bun's `fetch` — like WHATWG `fetch` — has no overall request deadline unless a `signal` is passed, so
a stalled peer would hang a workflow step until someone killed the run (task 0156 R5). Every plugin
HTTP call therefore passes `signal: AbortSignal.timeout(<ms>)`, sourced from one module-level
constant per plugin:

| Constant | Value | Scope |
| -------- | ----- | ----- |
| `PROVIDER_REQUEST_TIMEOUT_MS` | `300_000` | Every `image-gen` provider call. Declared in `src/providers/timeouts.ts` (a leaf module) and re-exported from `src/providers/types.ts` — it cannot live in `types.ts` directly, because that file builds the `PROVIDERS` registry from value imports of each adapter, so the constant would create a `types.ts ⇄ <adapter>` runtime cycle (TDZ on `create` for consumers that import an adapter first) |
| `ProviderOptions.timeoutMs` | optional | `image-gen` only, `@internal` test hook: providers resolve the timeout as `options?.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS`, so a test can drive the abort path without waiting 300s |
| `REQUEST_TIMEOUT_MS` | `120_000` | One per plugin in `aihot-ingest`, `web-search`, `emdash-pub`, `medium-pub`, `qiita-pub`, `x-pub`, `threads-pub` |
| `resolveVoiceboxTimeoutMs()` | `VOICEBOX_TIMEOUT_MS` or `600_000` | `voice-gen`, shared by `voicebox-client` and `voicebox-server` |

Already-signalled at the time of the fix and unchanged: `podcast-pub/src/microfeed-client.ts`
(`MICROFEED_TIMEOUT_MS`) and the `surfdash-pub` live-URL poll (`AbortSignal.timeout(5_000)`).

## 4. Public package surface

### `@gobing-ai/kk-core` (`packages/kk-core`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `DocSchema`, `ContentSchema`, `ResultSchema`, `DocListSchema`, `omniVoiceGenContentSchema` | Zod schemas | Pure data contract schemas; `omniVoiceGenContentSchema` pins omni-voice-gen audio output (`format: "audio"`, `metadata.generator: "kk:omni-voice-gen"`, F611/0121) |
| `TargetOutcomeSchema`, `AggregateResultSchema` | Zod schemas | Fan-out aggregate `Result` (spec §3.1): per-target `published \| failed \| skipped` outcomes + summary counters; prior-ledger reads validate through it (0110 I4, 0157 R11) |
| `TargetOutcome`, `AggregateResult` | types | Inferred from the two schemas above (0157 R11) |
| `BriefSchema`, `GeneratorInputSchema` | Zod schemas | **Specified, not implemented** (ADR-007 R3; feature D) |
| `Doc`, `Content`, `Result` | types | Inferred TypeScript types |
| `Brief`, `GeneratorInput` | types | **Specified, not implemented** (ADR-007 R3; feature D) |
| `PLUGIN_KINDS`, `PluginKind`, `PluginKindSchema` | constants & schema | Supported plugin lifecycle kinds |
| `PLUGIN_KIND_COLLECTIONS`, `PLUGIN_COLLECTION_KINDS`, `KK_CAPABILITY_COLLECTION` | constants | ADR-009 collection folder map |
| `collectionForKind(kind)`, `kindForCollection(name)` | functions | Kind ↔ collection directory |
| `kindContract(kind)` | function | Resolves I/O contract per plugin kind |
| `PluginManifestSchema`, `parsePluginManifest`, `PluginManifest` | schema & type | Validation for `plugin.json` manifests (loose object — unknown keys kept) |
| `OperationIOSchema`, `OperationIO`, `PluginOperation` | schema & types | Declared auxiliary-operation IO forms (`doc-list \| markdown`); surface on `PluginRecord.operations` (0110 I3) |
| `discoverPlugins(root)`, `discoverAllPlugins(opts)`, `resolvePluginRoots(opts)`, `listByKind`, `getByName` | functions | Per-root scan, merged multi-root discovery, root resolution, and registry filtering (ADR-012) |
| `PluginRecord`, `PluginOrigin`, `DiscoverAllOptions`, `DiscoveryDiagnostic`, `DiscoveryResult` | interfaces | Structured discovery output types (`misplaced`, `kind_mismatch`, `shadowed` codes; `origin` on every record) |
| `renderContentMarkdown(content)`, `renderContentMarkdownFile(in, out)`, `main()` | functions | Content → research-report markdown (frozen template) + `--in`/`--out` file/CLI wrapper (task 0058). **C5 (ADR-013):** drops the `## Outline` replay (applied to the byte-identical `plugins/kk/scripts/render-md.ts` copy too); references tail resolves cite ids to cached files |

### `@gobing-ai/kk-store` (`packages/kk-store`)

The kk-owned SQLite store (ADR-030): schema, embedded migrations, DAOs, and the store path resolver.
It is the **only** package permitted to import `@gobing-ai/ts-db` or `drizzle-orm`, enforced by
`.spur/rules/boundary/dao-boundary.yaml`. The public surface is deliberately ts-db-free — no ts-db
type crosses `src/index.ts`.

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `openStore(opts)`, `Store`, `SQLITE_BUSY_TIMEOUT_MS` | function / interface / const | Lazily imports `createDbAdapter`, opens `{ driver: 'bun-sqlite', url: path }`, sets WAL + `busy_timeout`, applies `KK_MIGRATIONS`, returns the DAO bundle plus `appliedMigrations`; closes the adapter when a migration fails |
| `resolveStorePath(configFile?, explicitPath?)`, `DEFAULT_STORE_DB_PATH` | function / const | `--db` → `store.db_path` → `.works/kk.db`; expands `~`, resolves a relative path against cwd, creates parent dirs. Async: file IO goes through ts-runtime's `FileSystem` seam (the repo's `no-direct-fs-io` rule), and config path is passed in because `apps/cli` depends on this package, never the reverse |
| `canonicalUrl(url)`, `itemId(doc)` | functions | Pure identity helpers: lowercase scheme/host, drop the fragment and `utm_*`/`ref`/`ref_src`/`fbclid`/`gclid`, sort the remaining query params, strip the trailing slash (root excepted). `itemId` = `sha256(canonicalUrl)`, or `sha256(title + body)` for a URL-less Doc |
| `ItemsDao`, `CollectRunsDao`, `LabelsDao`, `SelectionsDao`, `LocksDao` | classes | ts-db `EntityDao` subclasses over `items`, `collect_runs`, `labels`, `selections`, `locks`. `ItemsDao.upsertDocs(runId, docs)` upserts in one transaction and deletes that item's `labels` rows when `content_hash` changes; `LabelsDao.upsertLabel(input)` writes `value`/`score`/`confidence`/`run_id` per (item, decision), its `confidence` being the `HIGH \| MEDIUM \| LOW` verdict level (`labelConfidence(source, confidence)` maps the model's 0–1 payload into the enum, `verdictConfidence(levels)` is a pass's weakest level); `LocksDao.acquire(name, runId, ttlMs)` is the single-flight primitive (a stale holder is stolen past `acquired_at + ttl_ms`) |
| `itemFacts(doc)`, `ItemFacts`, `SourceTier` | function / types | The deterministic fact columns (0227 R1): `engagement`, `bodyChars`, `sourceTier`, `lang`, `domain` |
| `storyTokens(title)`, `storyIdFor(title, candidates, threshold)`, `StoryPolicy`, `StoryCandidate`, `DEFAULT_STORY_POLICY`, `DEFAULT_STORY_THRESHOLD`, `DEFAULT_STORY_WINDOW_HOURS` | functions / types / consts | Deterministic title-clustering key (0227 R2): CJK bigrams + Latin words, Jaccard at `>= threshold`, ties by earliest `first_seen_at` then smallest `id` |
| `ItemRecord`, `UpsertDocsResult`, `CollectRunRecord`, `LabelRecord`, `LabelSource`, `LabelConfidence`, `LockRecord`, … | types | Row and input types for the DAOs above; `LabelRecord.confidence` is the `HIGH \| MEDIUM \| LOW` level, `null` only on a row no `kk store label` pass wrote |

Migrations are embedded `KkMigration[]` (`{id, sql}`, append-only; `0001_kk_store_init` + `0002_labels_confidence_run_id` today) whose
DDL is derived from each `defineTable(...).createTableSql` — there is no hand-written DDL file — and
journaled in `__kk_store_migrations(id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`. A released id
is never edited. Because a fresh `0001` derives its DDL from the live schema, it already carries any
column a later migration adds; `applyKkMigrations` therefore skips (and reports) a `duplicate column
name` from `ALTER TABLE … ADD COLUMN` while every other error fails closed, so a fresh database and
one migrated from an older journaled `0001` converge on the same columns.

### `@gobing-ai/publish-harness` (`packages/publish-harness`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `PublishTransport` | interface | `{ kind: 'file-cli' \| 'browser', driver?: 'script' \| 'agent', publish(payload): Promise<Result> }` (ADR-008 amdt 2026-09-17) |
| `PublishTransportPayload` | interface | `{ content: Content, options?: Record<string, unknown> }` |
| `FakeFileCliTransport` | class | Offline fake for unit tests; `setNextResult` is sticky until `reset()` (every subsequent `publish()` returns it), records call log |
| `FakeBrowserTransport` | class | Offline fake for `kind: 'browser'`; same sticky `setNextResult` until `reset()`, records calls, `reset` |
| `BrowserDriver` | type | `'script' \| 'agent'` — required when `kind` is `browser` |
| `resolveBrowserProfileDir` | function | `~/.config/kk/browser-profiles/<channel>`; optional override (env/flag), always returned absolute |
| `trySelectors` | function | First attached (optionally visible) selector; point-in-time visibility check — `timeout` is forwarded to `isVisible` for `SelectorLocator` compatibility but Playwright ignores it (returns immediately); structural page type, no Playwright import |

> **0177:** the persistent-browser launcher moved out of this package into `@gobing-ai/ts-browser-automation` (`openPersistentBrowser` / `loginWithProfile` / `withProfilePage`); xhs-pub binds it directly. `launchPersistentBrowser` was removed — no in-repo consumer remains. **0214:** the default `BrowserLauncher` those operations receive is `kkBrowserLauncher` from `./browser` (full-Chromium channel + stealth launch); every browser channel passes it when no launcher is injected.

#### `@gobing-ai/publish-harness/browser` (`packages/publish-harness/src/browser.ts`)

Shared browser command library behind the `./browser` sub-path export (ADR-027, E91). Plugins that
only need the package root (`src/index.ts`) never load this module or
`@gobing-ai/ts-browser-automation` (R5).

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `ChannelBrowserConfig` | interface | `{ channel, homeUrl, isAuthenticated, loginTimeoutMs?, checkHeadedOnly? }`; `isAuthenticated` is the site-owned readiness predicate, `loginTimeoutMs` defaults to `180000`; `checkHeadedOnly` (0216) makes `runProfileCli check` skip the headless pass for WAF-451 channels (infoq, juejin, x `article`) |
| `ChannelSessionResult` | interface | `{ status: 'verified' \| 'refused', profileDir, detail }`; the detail carries the profile dir path only, never credentials or profile content |
| `resolveChannelProfileDir(channel, override?)` | function | `override` > `<CHANNEL>_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir(channel)`; blank tiers count as unset, no directory is created |
| `kkBrowserLauncher` / `createKkBrowserLauncher(loadPlaywright?)` | const / function | Default `BrowserLauncher` for every browser channel when none is injected (0214). It launches with `channel` from `KK_BROWSER_CHANNEL` (default `chromium`), `--disable-blink-features=AutomationControlled`, `ignoreDefaultArgs: ['--enable-automation']`, and a `navigator.webdriver` init script, so Google OAuth works. Profile semantics match upstream: an existing dir is adopted, headed creates a missing one with 0o700, headless refuses with `BrowserProfileMissingError`, and busy/missing-browser failures map to typed errors. E2E: `bun packages/publish-harness/scripts/e2e-launcher-session.ts [artifact]` |
| `checkChannelSession(config, opts)` | function | Default launcher `kkBrowserLauncher`. Read-only headless probe (`homeUrl` + predicate), one headed retry unless `headedFallback: false`; `headedOnly: true` skips the headless pass entirely (beats `headedFallback: false`); a missing profile is refused immediately and never created |
| `runProfileCli(config, argv?, deps?)` | function | `login\|check\|open [--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]`; `login` is headed `loginWithProfile` (in bot mode, i.e. with `--url`, it appends the `{status:'verified', profileDir, defaultUrl}` verdict line the `kk bot` parent persists), `check` is `checkChannelSession` (`--headed` or `config.checkHeadedOnly` → `headedOnly: true`, 0216), `open` is `openChannelSession` (0277: requires both `--profile` and `--url`, headed, waits for the operator's context close, asserts no authentication); exit 0 verified / 1 refused / 2 usage error, one line per message through the injected `stdout` |
| `waitUntil(predicate, timeoutMs, pollMs = 500)` | function | Poll to the deadline, then one final predicate call |
| `resolveSelector(page, selectors, opts?)` | function | First **attached** candidate of a selector list, polled to `timeoutMs`; throws naming `label` (default `selector`), every candidate and the deadline — the selector lists themselves stay site-owned in the plugin (E91-D3) |
| `pasteHtml(page, selector, html, opts?)` | function | Synthetic `ClipboardEvent('paste')` carrying `text/html` + `text/plain`, then asserts the editor text is non-empty |
| `fillCodeMirror(page, selector, markdown, opts?)` | function | CodeMirror 6 `view.dispatch` → CodeMirror 5 `CodeMirror.setValue` → `keyboard.insertText`, then asserts the editor text is non-empty |
| `uploadFile(page, selector, filePath, opts?)` | function | Attached `input[type=file]`; visibility is not required |
| `expectOutcome(probe, { timeoutMs, label, pollMs? })` | function | `{ ok: true, evidence }` or `{ ok: false, error }`; success only from an observed browser signal (E91-D6) |
| `markdownToHtml(markdown)` | function | `Bun.markdown.html` (E91-D4) — GFM tables, fenced code, task lists; no markdown dependency |
| `injectBrowserAntiDetection(page, options?)` | function | Opt-in MAIN-world anti-detection hooks for one page (0288). With `shieldProfile`, intercepts only the exact `/shield/webprofile` path (query allowed) on `allowedOrigins` across `fetch`, `XMLHttpRequest` and `navigator.sendBeacon`, answering the synthetic `{code:0,success:true,msg:'ok',data:{st}}` JSON receipt with a native-like `toString`; unrelated calls pass through untouched. Idempotent per document (same-config reinstall is a no-op, conflicting options throw); defaults install nothing |
| `queueBrowserFiles(page, files)` / `BrowserPendingFile` | function / type | Host-validated pending browser files (`{name, mimeType, base64}`; ≤20 files, ≤8 MiB decoded) queued onto the installed chooser hook; `input[type=file].click` with a valid one-shot batch assigns via `DataTransfer` and fires `input`+`change` instead of the native dialog; ineligible clicks keep native behavior (0288) |
| `IsAuthenticatedPredicate`, `BrowserLauncher` | types | Re-exported from `@gobing-ai/ts-browser-automation` for the config and deps seams |

Every helper failure throws an `Error` naming the selector (or the outcome label) and the timeout;
transports convert it to `{ ok: false, error }`. Site selectors and URLs stay in each channel plugin
(E91-D3) — this module never embeds one.

#### Publish transport verdict (ADR-027, E91)

Recorded per-publisher verdict and its reason; rationale in
[design/browser-publish-channels.md](design/browser-publish-channels.md) §1. `driver` is only
meaningful for `kind: 'browser'` transports.

| Publisher | Transport | Verdict | Reason |
| --------- | --------- | ------- | ------ |
| `infoq-pub` | browser · `script` | Implement | No public write API; ProseMirror editor at `xie.infoq.cn/draft/<id>` (entered via the home page's write button) |
| `juejin-pub` | browser · `script` | Implement | No public write API; bytemd editor (CodeMirror, markdown) |
| `substack-pub` | browser · `script` | Implement | No public write API; ProseMirror editor, HTML paste |
| `x-pub` `article` | browser · `script` | Implement | No Articles API; `x.com/compose/articles`, HTML paste + cover upload |
| `x-pub` `post` | `file-cli` (API v2, OAuth 1.0a) | Keep | Official, deterministic, headless; browser posting invites anti-bot flags |
| `threads-pub` `post` | `file-cli` (Threads Graph, two-step container → publish) | Keep | Meta's official publishing API, deterministic and headless; no browser path exists in this channel |
| `weibo-pub` `post` / `article` | browser · `script` | Implement | The open-platform share endpoint needs an approved app plus a bound safe-domain URL in every post; the web composer (post) and 头条文章 editor (article) are the delivery path, draft by default |
| `medium-pub` | `file-cli` (REST, integration token) | Keep | Works for existing token holders; the browser console path fights Cloudflare — **deferred** until the token path stops accepting posts (R12) |
| `qiita-pub` | `file-cli` (API v2) | Keep | Official API; a browser flow is strictly worse |
| `zenn-pub` | `file-cli` (zenn-cli + git sync) | Keep | Git sync is Zenn's official publishing model |
| `xhs-pub` | browser · `script` | Migrate plumbing | Already on the package (0177/ADR-024): profile resolution, `waitUntil` and the session check come from `@gobing-ai/publish-harness/browser`; its guard-wrapped `main()` stays |
| `wechatmp-pub` | browser · `script` | Migrate plumbing (poll only) | Only its poll loops move to `waitUntil`; login/check stay bespoke (storageState capture + cookie re-injection) and its profile dir has no `KK_BROWSER_PROFILE_DIR` tier |

### `@gobing-ai/surfdash-pub` (`plugins/publishings/surfdash-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `PostsurfingFileCliTransport` | class | `file-cli` transport: `postsurfing` CLI child process; requires `POSTSURFING_BIN` (default: on PATH); routes `options.operation`: `publish` (default) / `scaffold-locale` (`sd translate` scaffold + assets copy → `metadata.draftPath`; targets `en`/`ja`) / `sync` (publish-orchestrator) — 0096. On publish success the transport commits + pushes only the post path to `main` (pathspec commit; deploy.yml builds the site) and polls the article URL until 2xx (`metadata.live`, `metadata.gitCommit`; push acceptance is authoritative — an unverified URL stays non-fatal). EmDash 401/`INVALID_TOKEN` errors surface with a regenerate-the-token hint. Path-derived metadata is validated before any filesystem effect (0156 R4): `metadata.runDate` must be `YYYYMMDD`, the resolved post dir must stay one segment under `content/posts/articles/<locale>`, and `metadata.coverImage` must carry a known image extension (`.png`/`.jpg`/`.jpeg`/`.webp`/`.gif`); a violation returns `ok:false` and writes nothing. Invalid `--in` Content yields the spec §2.5 `ok:false` Result plus a non-zero exit instead of an uncaught `SyntaxError` (0156 R7) |
| `mapContentToSurfingMarkdown(content)` | function | Renders Surfdash markdown + frontmatter (title, description, tags, date, canonical_url, published) |
| `processPublishIO(inputPath, outputPath, transport?)` | function | `--in`/`--out` IO per the publish spec §1; forwards a top-level input `options` object to the transport (operation selection, 0096) |
| `main()` | function | `--in`/`--out` arg parsing; exit 0 success / 1 failure |

### `@gobing-ai/zenn-pub` (`plugins/publishings/zenn-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `ZennCliFileCliTransport` | class | `file-cli` transport: `npx --yes --package zenn-cli@0.5.4 zenn new:article` + `articles/<slug>.md` write + git scoped to that article (`rev-parse --abbrev-ref HEAD` must be `main`, then `add -- <path>`, `commit -m <msg> -- <path>`, `push origin main`); requires `ZENN_REPO`; `url` comes from `ZENN_USERNAME` |
| `mapContentToZennMarkdown(content)` | function | Renders Zenn frontmatter (title, type, emoji, topics, published, slug) + body |
| `processPublishIO(inputPath, outputPath, transport?)` | function | `--in`/`--out` IO per the publish spec §1; writes fail-loud `Result` |
| `main()` | function | `--in`/`--out` arg parsing; exit 0 success / 1 failure |

### `@gobing-ai/qiita-pub` (`plugins/publishings/qiita-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `QiitaApiTransport` | class | `file-cli` transport: `POST /api/v2/items` via `fetch` with Bearer token; requires `QIITA_TOKEN` |
| `mapContentToQiitaMarkdown(content)` | function | Renders Qiita frontmatter (title, block-style tags, private) + body |
| `processPublishIO(inputPath, outputPath, transport?)` | function | `--in`/`--out` IO per the publish spec §1; writes fail-loud `Result` |
| `main()` | function | `--in`/`--out` arg parsing; exit 0 success / 1 failure |

### `@gobing-ai/medium-pub` (`plugins/publishings/medium-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `MediumApiTransport` | class | `file-cli`: GET `/v1/me` then POST `/v1/users/{id}/posts`; `MEDIUM_INTEGRATION_TOKEN`; default `publishStatus: draft` |
| `mapContentToMediumPost(content, options?)` | function | Medium create envelope (title, markdown/html, tags≤5, draft default) |
| `processPublishIO` / `main()` | function | `--in`/`--out` IO; fail-loud Result |

The browser fallback stays **deferred** (ADR-027, E91 R12): the integration-token REST path is the
only `medium-pub` transport, and a console/Playwright flow is added only if that path stops
accepting posts — the browser route fights Cloudflare, so it is not worth maintaining speculatively.

### `@gobing-ai/wechatmp-pub` (`plugins/publishings/wechatmp-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `WechatmpBrowserTransport` | class | `browser`: persistent-profile console flow via `@gobing-ai/ts-browser-automation`; headless session preflight (readiness = `/cgi-bin/home`), draft-first; missing session refuses fast with `ok:false` |
| `markdownToWechatHtml` / `checkWechatSession` | function | R9 inline-safe markdown→HTML; headless preflight seam |
| `processPublishIO` / `main()` | function | `--in`/`--out`; default `publishStatus` `draft`; `WECHATMP_PROFILE_DIR` overrides the profile dir |
| `uploadAndCropCover` / `centerCropRect` | function | CGI media (task 0289, `src/cgi.ts`): filetransfer `scene=8` cover upload on an authenticated `https://mp.weixin.qq.com` page (frozen query `action=upload_material,f=json,scene=8,writetype=doublewrite,groupid=1,ticket_id,ticket,svr_time,token,lang,seq,t` + multipart `type,id,name,lastModifiedDate,size,file`), then `cropimage?action=crop_multi` centered 2.35:1 + 1:1 crops computed from the upload's ACTUAL dimensions (crop geometry exported pure for tests); receipts validated (HTTP ok, `base_resp.ret` 0/absent + `err_msg=ok`, numeric fileid, exact-host `mmbiz.qpic.cn` HTTPS); `WechatCgiSession={token,ticket,userName,uin?}`, `WechatUploadedImage={fileId,url,width,height}`; bounds 2 MiB/response, 30 s/request, no retry, page-side AbortController, secrets never logged |
| `prepareArticleMedia` | function | CGI media orchestration (task 0289, `src/cgi-media.ts`): `(page, session, {html, coverPath, localImages}) → WechatArticleMedia={html, cover:{wide,square}, images}` — body images classified (exact-host CDN passthrough / public HTTP(S) transfer via frozen `uploadimg2cdn` contract requiring `errcode=0+file_id+url` / explicit `localImages` mappings (img src → local path; read + uploaded like the cover), ≤10 MiB/file + 20 MiB aggregate + ≤30 sources), exact-source dedupe, `DOMParser`-in-page anchor→span normalization preserving nested markup with `on*`/`javascript:`/`data:`/`vbscript:` attributes dropped, failed required image throws `WechatMediaError` before mutated HTML returns; 180 s total deadline; `CoverPair.crops` (task 0290) carries the actual `crop_multi` box coordinates on the receipt |
| `extractWechatCgiSession` / `assertEligibleCgiDraft` | function | CGI draft (task 0290, `src/cgi-draft.ts`): session extraction in-page — `location.search` token first, then bounded (≤2 MiB snapshot) regex scan of known inline assignments for `token`/`ticket`/`user_name`/optional `uin`; no eval, snapshot never exported; missing required values throw secret-free `WechatCgiDraftError('session-missing')`. Deterministic eligibility: operation `文章` + `publishStatus` absent\|draft + plain title/body/digest/author metadata against an explicit allowed set — anything else (advanced `metadata.wechatmp.*`, layout/settings/original/reward, unknown keys) is ineligible → DOM path |
| `buildCreateArticlePayload` / `createWechatArticleDraft` | function | CGI draft creation (task 0290, `src/cgi-draft.ts`): frozen `operate_appmsg?t=ajax-response&sub=create&type=77&token&lang=zh_CN` multipart baseline (`operate_from=Chrome`, `AppMsgId=''`, `count=1`, `data_seq=0`, `title0/author0/digest0/auto_gen_digest0/content0/sourceurl0`, cover `cdn_url0/cdn_235_1_url0/cdn_1_1_url0/cdn_url_back0` + `crop_list0` from the ACTUAL 0289 crop coordinates, `share_page_type0/share_imageinfo0/categories_list0/compose_info0` inactive defaults — no invented vendor scalars); receipt gate (`ret` 0/absent + safe numeric id) then id+title readback via `appmsg?action=list_ex` before returning `{appMsgId, editPath}`; single-shot — HTTP failure/timeout marks `metadata.ambiguousSubmission=true`, never retries, never DOM-falls-back; `editPath` carries no token |

The 2026-09-29 refactor replaced the HTTP `draft/add` transport (which needed `WECHAT_APP_ID`/`WECHAT_APP_SECRET` and a `thumbMediaId`) with a console browser flow (xhs-pub pattern): the console's `新的创作` menu opens the editor for the requested **operation** — 文章 (`createType=0`), 贴图 (`8`), 视频 (`5`), 播客 (`7`) — on `/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=<N>&token=<session>…`, **in a new tab**. Eligible plain-article DRAFT runs bypass this editor entirely (task 0290, ADR-026 amd 2026-10-15): `runMode` dispatches operation `文章` + draft + eligibility-passing content through the same-origin `operate_appmsg` CGI route (`runCgiDraft`) before any mode entry — ineligible content, no body images (`metadata.images[]` is mandatory for 文章 via `validateModeInput`), or an invalid required cover hands back to the DOM flow silently pre-dispatch. Body images are never dropped on the CGI route: they ride the 0289 media pipeline as `<img src>` prepended before the body HTML with `localImages` src→path mappings (cover = top-level `metadata.coverPath` when present, else the first body image, mirroring the DOM's 默认首图为封面); an unreadable cover hands back pre-dispatch, while a body image that exists but breaches the 0289 read bounds (≤10 MiB/mime/nonempty) fails loud as `ok:false` stage `media-preparation` (matching the DOM path's own hard failure). Once dispatched the route never retries and never falls back (ambiguous create = `ok:false` + `metadata.ambiguousSubmission`). Success carries the read-back draft `id` and the token-free canonical `appmsg_edit` URL. Everything below remains the DOM flow for advanced metadata, other modes and public operations. The body is the main-frame `div.ProseMirror` (the iframe UEditor is retired); the title is the ProseMirror block carrying `data-placeholder="请在这里输入标题"` — `textarea#title` is a hidden mirror, so filling it alone saves an empty title. Per-mode limits: title 文章 `0/64`, 视频/播客 `0/20`; author `input#author` `0/8` (原创-gated); digest `textarea#js_description` `0/120`. 视频/播客 start behind a modal media dialog that **covers the save bar**, so the artifact must be attached first and a missing artifact fails before any browser opens. Save is `保存为草稿`; `发表` is the publish control and is never clicked on a draft run. The draft signal is the `草稿箱` row's `更新于` timestamp (auto-save is continuous, the URL does not change, and `系统繁忙，请稍后再试` is not a failure). The cover comes from a body image (`从正文选择`; the panel states 默认首图为封面) because the editor exposes no cover file input, and `一键排版` → `匹配目标格式` applies the platform layout.

| operation | `createType` | required artifact | title |
| --------- | ------------ | ----------------- | ----- |
| `article` (文章) | 0 | body image (cover source) | required |
| `image-text` (贴图) | 8 | ≥1 image | optional |
| `video` (视频) | 5 | one video | `0/20` |
| `podcast` (播客) | 7 | audio + cover | `0/20` |

An undeclared `operation` fails by name before any browser or profile work. Live console evidence, selectors and the drift list: `docs/design/wechatmp-ui-discovery.md`. A save without an observed `.weui-desktop-toast` within 15 s is a loud failure — the plugin never reports success it did not see. `src/profile-check.ts login|check|open` owns the one-time QR sign-in (`~/.config/kk/browser-profiles/wechatmp`). No ADR-025 automation-guard: WeChat has issued no automated-activity warning; the headless preflight + draft default are the guard (conscious simplification). The daily workflow wires it as the `wechat-publish` state (`wechat_enabled: "true"`, draft-only — `wechat_live` stays a launch-time switch, outcome never enters `publish_status`). Draft metadata enrichment (2026-09-29; completed 2026-10-10): `metadata.wechatmp` drives post-save field filling in the editor — 合集 collection (`wechat_collection`, 每日AI资讯) and the cover are automated, 原创 / 赞赏 / 作者 / 原文链接 / 创作来源 stay automated under the 2026-10-13 re-measured selector maps (task 0272, after the operator console drifted): each settings row resolves through a candidate-selector probe before acting; a 赏-blocked account yields one explicit 前往开通/无法开启 warning, a build without the 原文链接 row yields one unavailable-capability warning (the `metadata.wechatmp.originalUrl` contract is kept for builds that expose it), and a build without 一键排版 skips silently — every enrichment failure stays fail-soft (`enrichWarnings`, leaked dialogs dismissed, draft save attempted) instead of stalling publish; committed DOM value/identity read-back is task `0260`'s real-Chromium regression. Every settings row follows the operator's measured shape — open the row, act in its dialog, click 确定 — which replaced the 2026-09-29 model where 原创 required the author to resolve to the 赏账户 search (headless-unresolvable) and 赞赏/原文链接 were skipped: `author` now reaches the article's 请输入作者 field from `metadata.wechatmp.author` (the plugin previously read only the generic `metadata.author` and left the field empty), defaults the 赞赏账户 when the platform leaves it empty, and `claimSource` carries the operator's own stance (`个人观点，仅供参考`) rather than the platform's AI-generation label. The 封面 comes from 图片库 (`从图片库选择` → first item → 下一步 → 确认) — the image the same run uploaded as the audio material's cover — and, when an audio material runs, the library pick is deferred until after the audio is present (0272); `metadata.wechatmp.coverSource: 'body'` still selecting the 从正文选择 path. Audio embed (2026-09-29): the daily MP3 is wired by the stage as `metadata.wechatmp.audioPath/audioTitle/audioCoverPath`; `insertAudioMaterial` opens the editor toolbar audio dropdown (`#audio_music_plugin_btn`) before the measured `li.js_insertaudio` menu item (2026-10-13), dedupes against the 素材库 by whitespace-stripped title (3 retries while rows stream in), inserts the found material at the caret (placed at the article start) and verifies placement top via evalJs; when the 素材库 holds no same-title material it now UPLOADS one (2026-10-10) — 上传音频 → audio file → 上传封面 → cover file → title → the 《公众平台音频上传服务规则》 acknowledgement (found by its own label text; an unticked box is a loud warning, never a silent save) → 保存 → the newest (first) material → 插入. The collection is a workflow var (`wechat_collection`, arg 5 of `daily-publish-wechat`); the stage appends a WeChat-only closing line (【咸话咸说】 platform pointer) to the input body and resolves `workDir` to an absolute path (plugin child cwd = plugin dir, relatives would ENOENT).

### `@gobing-ai/x-pub` (`plugins/publishings/x-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `XPostApiTransport` | class | `file-cli`: OAuth 1.0a `POST /2/tweets`; no browser fallback |
| `XArticleBrowserTransport` | class | `browser` / `driver: script`; headless session preflight, `x.com/compose/articles` Draft.js composer; observed `/compose/articles/edit/<id>` or fail-loud |
| `oauth1Header` | function | User-context OAuth 1.0a Authorization header |
| `processPublishIO` / `main()` | function | `--in`/`--out`; `options.operation` `post` (default) or `article` |

### `@gobing-ai/threads-pub` (`plugins/publishings/threads-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `ThreadsPostApiTransport` | class | `file-cli`: `POST /{THREADS_USER_ID}/threads` (`media_type=TEXT`) then `POST /{THREADS_USER_ID}/threads_publish` (`creation_id`); no browser fallback |
| `THREADS_OPERATIONS` / `resolveOperation` | const / function | Declared set is `post` alone; an unknown operation, any `options.driver` and any `options.images`/`metadata.images` are refused by name before a transport is built |
| `getPublishTransport` | function | `FakeFileCliTransport` under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`, else the Graph transport |
| `processPublishIO` / `main()` | function | `--in`/`--out`; validates the Content and the operation before resolving any transport |

`threads-pub` (2026-10-12, E94 / task 0243) is the Threads half of the x-pub split: text only, through Meta's official two-step publishing API (create a container, then publish it), so it has **no browser path at all** — a `driver` option is refused rather than ignored. Credentials are env-only (`THREADS_ACCESS_TOKEN` + `THREADS_USER_ID`), both checked, with `THREADS_USER_ID` named when absent. Text is `content.body.trim() || content.title?.trim()` (the schema has no `text` field, exactly as x-pub), counted in code points against `MAX_TEXT_CHARS = 500`, and overlong text is refused **without truncation** — x-pub's `slice(0, 280)` is deliberately not copied. Each request carries `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`; a non-2xx, a non-JSON body, a missing/empty/non-decimal id and a timeout each return `ok: false` naming the step (`threads container` vs `threads_publish`), the HTTP status when a response exists (never the raw body) and a bounded Graph `error.message`, and a publish-step failure also names the created container id. Every error passes through a redactor that removes the token value in both its raw and percent-encoded forms, so no Result, stderr line or `--out` file can carry it. The permalink lookup is a best-effort GET and can only shorten the Result: it is accepted only as an HTTPS `threads.net`/`threads.com` URL without token material, and any failure or rejection omits `url` without flipping `ok`. Deferred by decision (E94 scope): Threads media and carousel posts (they need a public `image_url` host), token refresh automation, container-readiness polling and retries.

### `@gobing-ai/weibo-pub` (`plugins/publishings/weibo-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `WeiboBrowserTransport` | class | `browser` / `driver: script`; headless session preflight, then one headed flow. `article` fills 头条文章 and clicks `保存草稿` (default) or the publish control; `post` fills the **mobile composer** (`https://m.weibo.cn/compose/`, measured 2026-10-12), optionally uploads one image, and **submits through the page's own mobile API** (`POST https://m.weibo.cn/api/statuses/update` with the page's `st` token and session cookies) — a synthetic click on either front end produces no request |
| `WEIBO_OPERATIONS` / `resolveOperation` | const / function | Declared set is `post` and `article`; an unknown operation is refused by name before a transport is built. `options.driver` is resolved separately and refuses anything but `script` |
| `WEIBO_POST_SELECTORS` / `WEIBO_ARTICLE_SELECTORS` | const | Ordered selector ladders (fail-closed). The post composer and image input were pinned live by task 0246 (2026-10-12); the 头条文章 ladder stays provisional because that editor is entitlement-gated for the test account |
| `isWeiboAuthenticated` / `WEIBO_CONFIG` | const | Readiness predicate (no login redirect, composer or editor reachable) and its site-owned config for `checkChannelSession` and the operator CLI |
| `getPublishTransport` | function | `FakeBrowserTransport('script')` under `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`, else the browser transport |
| `processPublishIO` / `main()` | function | `--in`/`--out`; validates the Content, the operation and the driver before resolving any transport |

`weibo-pub` (2026-10-12, E94 / task 0244) is the Weibo half of the x-pub split: a script browser flow with **draft by default** (E91-D5) and **success only from an observed signal** (E91-D6). Refusals all precede the browser, in this order: operation → driver → `publishStatus` value → post-without-`public` → post text → cover → session preflight. The home composer has no draft, so `post` **requires** `metadata.publishStatus: 'public'` — refusing beats silently going live. A post accepts **one** image (`.png .jpg .jpeg .webp .gif .bmp`, ≤ 5 MB per Weibo's documented `pic` limit) and refuses more than one, a non-image or an oversized file by name; it is no longer text-only (0246 R9). `article` fills the 头条文章 editor (title, then the body through the shared `pasteHtml` as rendered HTML), attaches an optional cover from `options.coverPath ?? metadata.coverImage` (absolute, existing `.png|.jpg|.jpeg|.webp`, refused pre-browser otherwise), reads both fields back, then clicks `保存草稿` — or the publish control only for `public`. Every success is a *fresh* signal: a draft needs a 保存草稿 toast that was not on screen before the click or a URL that left the editor entry carrying a draft id, a live article needs a `ttarticle` show URL, and a post needs the status id returned by the mobile API submit (`POST /api/statuses/update`; a response without an id is a refusal carrying Weibo's own bounded error) — so an already-visible toast, the editor URL itself or a submit that returns no id is never an outcome. Failure messages are one bounded line: the step, the deadline and the operator recovery command (`bun plugins/publishings/weibo-pub/src/profile-check.ts login`), never a DOM dump, cookie or stack. The session preflight is headless and single-pass (`headedFallback: false`); `checkHeadedOnly` belongs to the operator CLI and is deliberately never forwarded to a publish preflight, so a refusal can never escalate to a headed window.

**Announcement contract (episode is out, 0246 R8/R11).** The channel's Content is an announcement: `title` = the episode name, `body` = one hook line inside ~140 characters (the feed's *display* budget — Weibo allows up to 5000, so an over-long hook is a content defect, never a refusal and never truncated) followed by the episode link on its own line, `metadata.publishStatus: 'public'`, and `options.coverPath` for exactly one image. A body over the budget is the producer's problem; the plugin validates input, uploads the cover with a fresh observed attachment, and reports the observed status URL. Invocation (the reusable handoff surface for any workflow; daily/ITC wiring is a separate feature):

```bash
kk executor run weibo-pub --in weibo-announcement.json --out weibo-result.json
```

```json
{ "title": "S05E12 · MoE 推理的显存账",
  "body": "新一期上线：MoE 推理到底吃多少显存？三种量化档位实测，结论有点反直觉。\nhttps://episodes.example.com/s05e12",
  "format": "markdown",
  "metadata": { "publishStatus": "public" },
  "options": { "operation": "post", "coverPath": "/abs/path/s05e12-cover.png" } }
```

Route and limits are measured: `docs/design/weibo-ui-discovery.md` §2b (mobile composer), §4a (send-path diagnosis — **the account is flagged `errno 200001` and must be activated**, which is the one blocker for every live leg), §4b/§4c (route options and this contract).

**Account prerequisite (measured 2026-10-12).** Every live leg needs an **activated, verified account**: an abnormal-state account answers the submit with `errno 200001 账号异常` and an activation link (`m.weibo.cn/security`). The plugin renders that refusal as `HTTP <status> errno <code>: <msg> (<action>: <url>)`, so the operator sees the required action rather than a bare failure. Nothing is published while the account is in that state, on any route. Operator CLI: `bun plugins/publishings/weibo-pub/src/profile-check.ts login|check|open [--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]` over the shared `runProfileCli` (exit 0 verified / 1 refused / 2 usage); profile dir precedence `--profile` > `WEIBO_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `~/.config/kk/browser-profiles/weibo`. Deferred: the Weibo `statuses/share` API and the live 头条文章 selector measurements (blocked on the editor entitlement, 0246).

### `@gobing-ai/jike-pub` (`plugins/publishings/jike-pub`, kind `publish`)

| Export | Kind | Notes |
| ------ | ------ | ------- |
| `JikeBrowserTransport` | class | `browser` / `driver: script`; headless session preflight, then one headed flow. Operation `post` only — an unknown operation, any `options.driver`, a non-public/absent `metadata.publishStatus` (ADR-022: live-only, 即刻 has no evidenced draft flow), an empty body, an invalid `options.topic`, or invalid images (nonexistent file, non-`.png .jpg .jpeg .webp .gif` extension, more than the source cap of 9 — jike.js:246/329-331) are all refused before any browser opens |
| `JIKE_POST_SELECTORS` | const | Composer, topic input, file input and send control, each citing its grounding line in the read-only extension evidence (jike.js windows 59-99 / 204-250 / 300-385); `fileInput` is marked **provisional** — the source pastes media via clipboard events (jike.js:264-274), and the refine directs a native `setInputFiles` on the composer-scoped input instead of porting the vendor MultiSync |
| `resolveTopic` / `processPublishIO` / `main()` | function | Topic pre-validation (nonstring/empty refused), `--in`/`--out`; validates the Content and the operation before resolving any transport |

`jike-pub` (2026-10-14, task 0291) posts 即刻 dynamics through the web composer (`https://web.okjike.com`) as a script browser flow with **live-only delivery** — the flow fills the composer, reads the body back (stage `text-readback`), then commits `options.topic` only when a chip whose exact text equals the requested 话题 exists in the topic list (jike.js:219-225; no first-item or structural fallback — a lookalike or missing chip is a typed `topic-commit` refusal before anything is sent), uploads `options.images` in caller order through the harness file helpers with a 正在上传 wait and the source's own media-count predicate (stage `image-upload`; jike.js:46-52/277-291), and only then clicks the composer form's 发送 control. Success is only a *fresh* strong signal (jike.js:59-79): a success toast that was not on screen before the click, or a new `/originalPost/|/post/` link whose card reads back the body; the source's weak signals (editor cleared, composer closed — jike.js:81-85) alone never report success. Profile tiers follow the shared browser seam: `options.profileDir` → `JIKE_PROFILE_DIR` → `KK_BROWSER_PROFILE_DIR` → `~/.config/kk/browser-profiles/jike`; login is operator-owned via `bun plugins/publishings/jike-pub/src/profile-check.ts login` (ADR-032), and a missing profile is refused before the flow. Failure messages are one bounded line naming the typed stage and the recovery command, never a DOM dump or stack.

### `@gobing-ai/csdn-pub` (`plugins/publishings/csdn-pub`, kind `publish`)

| Export | Kind | Notes |
| ------ | ------ | ------- |
| `CsdnBrowserTransport` | class | `browser` / `driver: script`; headless session preflight, then one headed flow. Operation `article` only — an unknown operation, any `options.driver`, an unrecognized `metadata.publishStatus` (absent and `'draft'` mean draft — the frozen default; `'public'` publishes; anything else refuses per ADR-022's live-only posture for unmodeled states), empty title/body, an invalid cover path/extension, or a non-string/over-cap category/tag list are all refused before any browser opens |
| `CSDN_ARTICLE_SELECTORS` | const | Composer, title display/activator, title input, cledit body editor, tag input + committed-chip container, category control + option, publish-modal file input, 发布文章 entry and 发布 button, each citing its grounding line in the read-only editor-bundle evidence (csdn.js windows 32-41 / 202-207 / 223 / 249 / 340); `composer`, `tagInput`, `categoryControl`, `publishOpen`, `publishButton`, `coverInput` are marked **provisional** — grounded nodes (`titleDisplay`, `titleInput`, `bodyEditor`) drive readiness, provisional ones only fail loudly (typed stages, never silent fallback) |
| `DRAFT_SAVE_SELECTORS` | const | The frozen draft control `button.button-save[data-title="保存草稿"]` (Design refine pin; the top-level draft-labeled action only — the signed saveArticle API is never called) |
| `resolveOperation` / `processPublishIO` / `main()` | function | Operation validation (`article` only), `--in`/`--out`; validates the Content and the operation before resolving any transport |

`csdn-pub` (2026-10-15, task 0292) publishes Markdown articles through the CSDN web editor (`https://editor.csdn.net/md/`) as a script browser flow — every run writes to the real site (absent `publishStatus` defaults to a draft, `'public'` publishes live, and no offline/dry mode exists) — the flow probes grounded editor readiness (stage `editor-readiness`; provisional controls are recorded in the probe metadata, never guessed), fills the title through the grounded display-activator with strict whitespace-normalized readback (stage `title-readback`), fills the cledit `pre` body with real input events and reads the normalized text back (stage `body-readback`), opens the publish modal (stage `publish-open`), commits each requested tag with exact childless-leaf chip verification — the vendor's fixed 经验分享 tag is never substituted (csdn.js:206; stage `tag-commit`) — selects the requested category by exact option click with persisted-value readback and never accepts the source's empty-category silent fallback (csdn.js:207; stage `category-select`), and uploads the cover through the modal-scoped file input with a 上传中 settle and fresh media-count preview evidence (stage `cover-upload`; absent input is a typed refusal — no clipboard bridge, and the vendor's OBS/x-ca-* signing is deliberately not ported). Default (absent) and explicit `'draft'` runs are drafts: after field preparation (the publish modal is entered only when tags/category/cover are requested, and its final public submit is never clicked on a draft run) the flow activates only the top-level 保存草稿 control (stage `draft-enabled`), then confirms via a *fresh* id-bearing draft URL (`articleId=` editor shape or mp_blog shape) — stale, idless or toast-only states are typed `draft-save` failures with a bounded snapshot; the signed saveArticle API is never a fallback. `'public'` runs keep the public submit path. Baselines (toasts + receipt URLs, csdn.js:241-245/339-340) are captured before submit; success is only a *fresh* persisted receipt — for public runs `mp.csdn.net/mp_blog/creation/editor/<id>` (grounded csdn.js:340; `/article/details/<id>` provisional) or a fresh success toast — editor clearing alone never reports success; a fresh failure toast fails fast. Profile tiers follow the shared browser seam: `options.profileDir` → `CSDN_PROFILE_DIR` → `KK_BROWSER_PROFILE_DIR` → `~/.config/kk/browser-profiles/csdn`; login is operator-owned via `bun plugins/publishings/csdn-pub/src/profile-check.ts login` (ADR-032), and a missing profile is refused before the flow. Failure messages are one bounded line naming the typed stage and the recovery command, never a DOM dump or stack.

### `@gobing-ai/cnblogs-pub` (`plugins/publishings/cnblogs-pub`, kind `publish`)

| Export | Kind | Notes |
| ------ | ------ | ------- |
| `CnblogsBrowserTransport` (src/flow.ts) | class | `browser` / `driver: script`; headless session preflight, then one headed flow. Operation `article` only — an unknown operation, any `options.driver`, an unrecognized `metadata.publishStatus` (absent and `'draft'` mean draft — the frozen default), empty title, unsupported requested fields (`metadata.coverPath`/`metadata.tags`/`metadata.images` — this task implements none of them, they are refused, never claimed applied), invalid `metadata.categories` (non-string/nonempty entries), or local (non-HTTPS) Markdown image references — the vendor's XSRF `upload.cnblogs.com` endpoint is deliberately not ported and local paths are never leaked — are all refused before any browser opens |
| `CNBLOGS_ARTICLE_SELECTORS` (src/selectors.ts) | const | Title `input#post-title`, cledit-free `textarea#md-editor` and optional `textarea#summary` digest, each citing its grounding line in the read-only extension evidence (cnblogs.js fill 20-32: title 22/25, editor 23/26, summary 30-31; register map 35-37); category panel, draft (`保存草稿`/`存为草稿`) and publish (`发布博文`/`发布`) controls, receipt regexes and the login regex are declared **provisional** (the source is fill-only and proves no save protocol) and fail closed — bounded resolution, no broad primary-button fallback |
| `resolveOperation` (src/index.ts) / `processPublishIO` / `main()` | function | Operation validation (`article` only), `--in`/`--out`; validates the Content and the operation before resolving any transport |

`cnblogs-pub` (2026-10-15, task 0293) publishes Markdown articles through the 博客园 web editor as a script browser flow — every run writes to the real site, and `publishStatus` defaults to a **draft** (`发布博文` runs only on explicit `'public'`). The flow probes editor readiness (stage `editor-readiness`), fills the title through `input#post-title` and the body through the native `textarea#md-editor` with real input events and value readback (stages `title-readback` / `body-readback`; a present digest fills `textarea#summary`), then commits each requested category by clicking the label-associated checkbox whose exact text equals the requested existing account category and verifying the checked state (stage `category-commit`; categories are never created and first matches are never silently taken). Confirmation is only a *fresh* id-bearing receipt (draft edit URL or post URL, `CNBLOGS_RECEIPT_URL_RES`) plus persisted title/body/category state observed after save — stale assignments and toasts never report success, and an ambiguous/idless state is a typed `draft-save`/`publish-open` failure with a bounded snapshot. Profile tiers follow the shared browser seam: `options.profileDir` → `CNBLOGS_PROFILE_DIR` → `KK_BROWSER_PROFILE_DIR` → `~/.config/kk/browser-profiles/cnblogs`; login is operator-owned via `bun plugins/publishings/cnblogs-pub/src/profile-check.ts login` (ADR-032), and a missing profile is refused before the flow. Failure messages are one bounded line naming the typed stage and the recovery command, never a DOM dump or stack.

### `@gobing-ai/sspai-pub` (`plugins/publishings/sspai-pub`, kind `publish`)

| Export | Kind | Notes |
| ------ | ------ | ------- |
| `SspaiBrowserTransport` (src/flow.ts) | class | `browser` / `driver: script`; headless session preflight, then one headed flow. **Draft-only channel**: an explicit `metadata.publishStatus` of `'public'` (and any unrecognized status) is refused before any browser opens; absent and `'draft'` mean draft. An unknown operation, any `options.driver`, empty title/body, unsupported requested fields (`metadata.tags`/`metadata.images`/`metadata.categories` — this task implements none, they are refused, never claimed applied), or an invalid/missing `metadata.coverPath` local file are refused pre-browser |
| `SSPAI_ARTICLE_SELECTORS` (src/selectors.ts) | const | Title `textarea[placeholder="请输入标题..."]`, body `div[contenteditable="true"]` and the editor-scoped cover `input[type=file]` are grounded in the read-only extension evidence (sspai.js 26/50/82, 59-60, 32/38-40) — body is pasted as sanitized `text/html` through the shared `markdownToHtml` → plugin-local sanitizer → `pasteHtml` seam (source mechanism sspai.js 62-65); `a.editor-extra-button-preview` is grounded but is a **preview** control (sspai.js 68, 15-16) — probed read-only, reported, never clicked in the draft path; the save control (`保存草稿`/`保存`), editor URL `/post/write`, receipt regexes (`/post/<id>`, `/me/drafts/<id>`) and login regex are declared **provisional** (the source proves no save protocol; archive guides document draft saving historically only) and fail closed |
| `resolveOperation` (src/index.ts) / `processPublishIO` / `main()` | function | Operation validation (`article` only), `--in`/`--out`; validates the Content and the operation before resolving any transport |

`sspai-pub` (2026-10-15, task 0294) publishes Markdown articles to the 少数派 Matrix column as a script browser flow — every run writes to the real site, and this slice saves **drafts only** (`publishStatus: 'public'` is refused before launch). The flow probes editor readiness (stage `editor-readiness`), fills the grounded title with readback (stage `title-readback`), attaches a requested cover through the editor-scoped `input[type=file]` with assignment verification readback (stage `cover-attach`; a requested cover with no input, or an assigned-but-unverified input, is a typed failure — never the source's silent skip, sspai.js 17/43-45), pastes the sanitized HTML body and reads it back (stage `body-paste-readback`), then activates the provisional save control (stage `draft-save`). Success is only a *fresh* id-bearing receipt URL (`SSPAI_RECEIPT_URL_RES`) plus persisted title/body (and cover-state when requested) readback — stale, ambiguous or toast-only states are typed `draft-receipt`/`draft-save` failures with a bounded snapshot. Profile tiers follow the shared browser seam: `options.profileDir` → `SSPAI_PROFILE_DIR` → `KK_BROWSER_PROFILE_DIR` → `~/.config/kk/browser-profiles/sspai`; login is operator-owned via `bun plugins/publishings/sspai-pub/src/profile-check.ts login` (ADR-032), and a missing profile is refused before the flow. Failure messages are one bounded line naming the typed stage and the recovery command, never a DOM dump or stack.

### `@gobing-ai/xiaoyuzhou-pub` (`plugins/publishings/xiaoyuzhou-pub`, kind `publish`)

| Export | Kind | Notes |
| ------ | ------ | ------- |
| `XiaoyuzhouBrowserTransport` (src/flow.ts) | class | `browser` / `driver: script`; headless session preflight, then one headed flow. **Draft-only channel**: an explicit `metadata.publishStatus` of `'public'` (and any unrecognized status) is refused before any browser opens; absent and `'draft'` mean draft. Refused pre-browser: unknown operation, any `options.driver`, `format !== 'audio'`, empty title/body, missing/empty `metadata.podcastId`, missing/invalid `metadata.audioPath`+`mp3Path` (MP3/M4A/WAV only), audio above the local 500 MiB KK v1 cap (labeled as a local bound, not a platform limit), non-positive/non-finite `metadata.duration` (provenance only, never a measured upload duration), unsupported requested fields, invalid/missing `metadata.coverPath` |
| `XYZF_AUDIO_SELECTORS` (src/selectors.ts) | const | Audio `input#upload`, title `input[name="title"]` and the Draft.js shownotes editor `div[data-contents="true"]` are grounded in the read-only extension evidence (xiaoyuzhou.js 27-28, 55-56, 65-75) — audio is attached via Playwright `setInputFiles` on the local path (never base64/DataTransfer-in-page, source mechanism xiaoyuzhou.js 46-50 is deliberately not reproduced), and the vendor's bare `.value` title assignment (flagged `TODO(逆向存疑)` at xiaoyuzhou.js 57-58) is replaced by native input/change events with readback; shownotes paste as sanitized `text/html` through the shared `markdownToHtml` → plugin-local sanitizer → `pasteHtml` seam; the cover control (form-scoped `上传封面/单集封面` file input) and the save control (`保存草稿`/`保存`), receipt regexes (`episode/<id>`, `podcast/<id>`) and login regex are declared **provisional** (the vendor marks covers unsupported, xiaoyuzhou.js 17, and never saves, xiaoyuzhou.js 6/18-19) and fail closed |
| `XYZF_UNSUPPORTED_URL_RE` (src/selectors.ts) | const | Official podcaster studio precondition: desktop Chrome 147+ required, otherwise an `unsupported-browser` page — observed as an environment failure **before** upload; `KK_BROWSER_CHANNEL=chrome` selects the installed Chrome (bundled Chromium 155.0.8059.40 observed 2026-10-14 only, no compatibility promise), Playwright pin unchanged |
| `resolveOperation` (src/index.ts) / `processPublishIO` / `main()` | function | Operation validation (`podcast` only), `--in`/`--out`; validates the Content and the operation before resolving any transport |

`xiaoyuzhou-pub` (2026-10-15, task 0295) publishes podcast episodes with Markdown shownotes to the 小宇宙 podcaster studio as a script browser flow — every run writes to the real site, and this slice saves **drafts only** (`publishStatus: 'public'` is refused before launch). The flow verifies the requested show identity from `metadata.podcastId` before any upload (stage `show-verify`; the first/default show is never used and an unconfirmable identity is a typed failure), attaches the local audio via `setInputFiles` and waits for a processing-ready media record in the form — file assignment alone is never success (stage `audio-upload`; 600 s media ceiling, typed `upload-processing`/`upload-timeout` failures), fills the title with native input/change events and readback (stage `title-readback`), pastes sanitized HTML shownotes into the Draft.js editor with readback (stage `shownotes-paste-readback`), attaches a requested cover with preview-identity verification when the platform control exists (stage `cover-attach`; missing control is a typed failure, never the vendor's `unsupported` silent skip), then activates the provisional save control (stage `draft-save`). Success is only a *fresh* id-bearing episode receipt URL (`XYZF_RECEIPT_URL_RES`) plus persisted title/audio-identity/shownotes (and cover-state when requested) readback — stale, ambiguous, autosave-assumed or toast-only states are typed `draft-receipt`/`draft-save` failures with a bounded snapshot. Profile tiers follow the shared browser seam: `options.profileDir` → `XYZF_PROFILE_DIR` → `KK_BROWSER_PROFILE_DIR` → `~/.config/kk/browser-profiles/xiaoyuzhou`; login is operator-owned via `bun plugins/publishings/xiaoyuzhou-pub/src/profile-check.ts login` (ADR-032), and a missing profile is refused before the flow. Failure messages are one bounded line naming the typed stage and the recovery command, never a DOM dump or stack.

### `@gobing-ai/shipinhao-pub` (`plugins/publishings/shipinhao-pub`, kind `publish`)

| Export | Kind | Notes |
| ------ | ------ | ------- |
| `ShipinhaoBrowserTransport` (src/flow.ts) | class | `browser` / `driver: script`; headless session preflight, then one headed flow. Operation `shortVideo` only. Default draft (`publishStatus` absent or `'draft'`), explicit `'public'` supported. Refused pre-browser: unknown operation, driver≠script, non-video format, empty title/body, missing/invalid `metadata.videoPath` (MP4/MOV only), video above local 2 GiB KK v1 cap, invalid `metadata.coverPath`/`metadata.tags`, non-boolean `metadata.original`, unrecognized `publishStatus`, and unsupported vendor enhancements (`images`, `scheduling`, `publishTime`) |
| `SHP_VIDEO_SELECTORS` (src/selectors.ts) | const | Video file input, title input, description editor, cover dialog controls, 声明原创 controls, 保存草稿 and 发表 buttons. The wujie-app root policy (shipinhao.js:3-5, 514-545) polls the open shadow root up to 30s and never falls back to document when `<wujie-app>` is present; direct creator form probes require a unique candidate. Video attach uses `setInputFiles` and verifies post-upload form appearance (600s ceiling, assignment alone never success); description pastes sanitized HTML through `markdownToHtml` → plugin-local sanitizer → `page.evaluate` paste; `metadata.original === true` executes the 3-step 声明原创 sequence with committed readback; cover commit verifies the post-dialog slot card; receipt requires fresh id-bearing works URL (`SHP_RECEIPT_URL_RES`) and persisted state readback |
| `resolveOperation` (src/index.ts) / `processPublishIO` / `main()` | function | Operation validation (`shortVideo` only), `--in`/`--out`, ResultSchema validation |

`shipinhao-pub` (2026-10-15, task 0296) publishes short videos with descriptions/topics to WeChat Channels (视频号助手, channels.weixin.qq.com) as a script browser flow — every run writes to the real site, defaulting to **draft** (`保存草稿`), with explicit `'public'` (`发表`) supported. The flow traverses the `<wujie-app>` open shadow root when present (never falling back to document) or direct creator form evidence (stage `root-resolve`), attaches the local video via `setInputFiles` and waits for post-upload form appearance (stage `video-upload` / `upload-processing`), fills the title natively with readback (stage `title-readback`), pastes sanitized description/topics HTML and reads it back (stage `description-paste-readback`), optionally commits the explicit 声明原创 declaration sequence if `metadata.original === true` (stage `original-declare`), optionally attaches and commits a cover card (stage `cover-attach`), and activates the save or publish control. Success requires a *fresh* id-bearing receipt URL plus persisted state readback — stale receipts and unobserved completion are typed failures. Profile tiers: `options.profileDir` → `SHP_PROFILE_DIR` → `KK_BROWSER_PROFILE_DIR` → `~/.config/kk/browser-profiles/shipinhao`; login is operator-owned via `bun plugins/publishings/shipinhao-pub/src/profile-check.ts login` (ADR-032).

### `@gobing-ai/bilibili-pub` (`plugins/publishings/bilibili-pub`, kind `publish`)

| Export | Kind | Notes |
| ------ | ------ | ------- |
| `BilibiliBrowserTransport` (src/flow.ts) | class | `browser` / `driver: script`; headless session preflight, then one headed flow. Target `bilibili`, operations `shortVideo` (default) and `dynamic`. For `shortVideo`, `publishStatus` defaults to draft (`保存草稿`), explicit `'public'` (`投稿`, resulting in `status: 'pending-review'`). Refused pre-browser: unknown operation, driver≠script, format≠video, empty title/body, title >80 chars (reject excess), missing videoPath, video above 2 GiB local cap, missing partition, tags >10 entries. For `dynamic`, `publishStatus: 'public'` is required (drafts unsupported, absent/draft refused pre-browser); requires body or images (max 9); partition/video/cover/audio fields refused |
| `BILI_VIDEO_SELECTORS` & `BILI_DYNAMIC_SELECTORS` (src/selectors.ts) | const | Video candidate selectors grounded in bilibili.js:290-556 (file input, title `input[maxlength="80"]`, tags input, cover dialog with " 完成 " crop confirm and slot preview verification, 自制 radio, submit button `span.submit-add`); dynamic selectors grounded in bilibili.js:158-287 and bilibili-main.js:33-86 (contenteditable editor `div[placeholder*="想和大家分享"]`, image upload via native file input, launch button `button.bili-dyn-publishing__action__launch`). Video attach uses `setInputFiles` on local path and verifies post-upload form appearance (600s ceiling, assignment alone ≠ success); dynamic attaches images via `setInputFiles` and reads back image count |
| `resolveOperation` (src/index.ts) / `processPublishIO` / `main()` | function | Operation validation (`shortVideo` and `dynamic`), `--in`/`--out`, ResultSchema validation |

`bilibili-pub` (2026-10-15, task 0297) publishes videos and dynamic posts to Bilibili (哔哩哔哩, member.bilibili.com / t.bilibili.com) as a script browser flow — every run writes to the real site. Operation `shortVideo` defaults to **draft** (`保存草稿`), with explicit `'public'` (`投稿`) resulting in a pending-review receipt with aid/bvid. The flow attaches the local video via `setInputFiles` and waits for post-upload form appearance (stages `video-upload` / `media-processing`), fills the title natively (≤80 chars, stage `title-fill`), selects the exact requested partition (stage `partition-select`), commits up to 10 tags with Enter key events (stage `tags-fill`), commits an optional cover card through the dialog ladder with " 完成 " confirmation and slot preview verification (stage `cover-attach`), selects 自制 when requested, fills the description editor (stage `description-fill`), then activates the save control (stage `draft-save`) and requires a *fresh* id-bearing draft receipt URL (stage `draft-receipt`) — a toast or an unchanged URL is a typed failure, never a claimed save; the explicit public rail submits via 投稿 and requires a fresh receipt with `status: 'pending-review'`, never a fabricated public URL. Operation `dynamic` publishes text and up to 9 images to Bilibili dynamic (`t.bilibili.com`) with explicit `'public'` status only (drafts refused pre-browser), pasting sanitized text (stage `text-fill`), attaching images via `setInputFiles` (stage `images-upload`), clicking the launch button (stage `publish-click`), and confirming only on a signal absent from the pre-click baseline — a fresh receipt URL, a newly visible toast, or a link not present before the click (stage `publish-receipt`). Profile tiers: `options.profileDir` → `BILIBILI_PROFILE_DIR` → `KK_BROWSER_PROFILE_DIR` → `~/.config/kk/browser-profiles/bilibili`; login is operator-owned via `bun plugins/publishings/bilibili-pub/src/profile-check.ts login` (ADR-032).

### Leftover CMS browser plugins (`juejin-pub`, `infoq-pub`, `substack-pub`, `xhs-pub`)

Each is `kind: publish`, `PublishTransport.kind: 'browser'`. Offline tests use `FakeBrowserTransport`. Profile dir `~/.config/kk/browser-profiles/<channel>`. A missing or expired session is `Result.ok false` in one line naming the operator login command and the profile dir path — never a stack, cookie, or page HTML (ADR-027 channels; the shared `checkChannelSession` refusal).

`xhs-pub` (0177) opens its browser through `@gobing-ai/ts-browser-automation`: `makeDefaultOpenPage` defaults to `kkBrowserLauncher.launch` (0214, `defaultLauncher`, exported so the binding is provable offline), retaining its injectable launcher function and `OpenPage` seam. It closes the context if page setup fails; otherwise the publish flow owns closure. The profile helpers inject the upstream `BrowserLauncher` object (`{ launch({ profileDir, headless }) }`). Headless never fabricates a session — upstream refuses with `BrowserProfileMissingError`. In a source checkout, `src/profile-check.ts` provides the operator CLI: `bun plugins/publishings/xhs-pub/src/profile-check.ts login|check|open [--profile <dir>] [--url <url>] [--timeout <ms>]` — `login` opens the headed creator console for a one-time sign-in, `check` verifies the saved session read-only and headlessly (exit 0 verified / 1 refused). Profile dir precedence: `--profile` > `XHS_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir('xhs')`.

`xhs-pub` (image cards) defaults to `driver: 'script'` — ordered card images are uploaded with Playwright `setInputFiles` (`Upload ordered card images` in `docs/design/xhs-image-cards.md`); the `agent` driver fails fast (`unsupported driver … requires the script driver`). The flow follows the live console as measured 2026-09-25 (task 0174): the in-viewport 图文 tab is force-clicked first and doubles as the login gate; the image input is a hidden `input[type="file"][accept*=".jpg"]` found by attachment (not visibility); previews are counted as `img.preivew-image`; the body is TipTap ProseMirror and is typed rather than value-set; and the submit bar's `暂存离开`/`发布` controls live in the **closed** shadow root of `<XHS-PUBLISH-BTN>`, so they are resolved through CDP box models and clicked at the measured centre (a driver without CDP fails loud). Draft completion is confirmed only from a delta against the pre-entry baseline (the console's draft counter moved, or a `保存于<timestamp>` entry appeared that was not already there) — XHS autosaves uploads, so a merely readable counter is not evidence; an unobserved outcome is reported as a failure, never as success.

`xhs-pub` (2026-10-05, ADR-029 / feature E92) declares four operations instead of one image-text path: `image-text` (≤18 images), `video` (one video file), `long-article` (no upload — authored **in place from the markdown**, then `一键排版` → `匹配目标格式`; `导入链接` is excluded by decision because it is fed from a 公众号 source), and `podcast` (audio + cover through the modal; its RSS path is excluded). An undeclared `operation` fails by name before any browser or profile work. Mode entry switches the console's `.creator-tab`; the tab set mounts late and every tab renders an `aria-hidden` clone plus an off-screen clone (`x=-9726`), so only the on-screen instance may be clicked. The action bar's `暂存离开` lives in a **closed shadow root** in 图文 (light DOM in 写长文) and is resolved through the shared `findShadowControl` (`@gobing-ai/publish-harness/browser`) — the plugin no longer carries a private CDP walk. The draft signal is the `保存成功` toast plus the `草稿箱` counter, read through `readScopedSignal`; the URL does not change. Live evidence, selectors and drift: `docs/design/xhs-ui-discovery.md`.

`xhs-pub` (2026-10-09, ADR-025 amendment / task 0236) — **one visit may compose several notes.** A `Content` whose `metadata.followUps` holds further `Content` objects makes one headed visit run the primary operation and then each follow-up in the same browser session, after the single `allow('publish')` check; `record('publish')` still happens once per visit. Each operation is entered from the creator landing (its own `goto` + login gate + pre-entry draft baseline), gets its **own Result entry** (the primary is the visit's Result, its follow-ups are `metadata.followUps[]`), and keeps its own draft/publish rail: a draft claims a save only from a console signal, and `去发布`/`发布` is clicked only on `publishStatus: 'public'`. Follow-ups are planned before the browser opens like the primary, but an unplannable follow-up (undeclared operation, missing artifact) or a failed one never fails the visit — it is that entry's `ok:false`. Every entry carries `metadata.operation` (the operation it was planned under, else its `followUps[<i>]` slot; a step's own metadata wins), so a failed or refused note is identifiable. The 发播客 modal's post-attach save path is still **unmeasured** (only `去发布` is on file, and a draft run does not click it), so a draft 发播客 entry fails with `… its post-attach save path has never been measured …` and the visit's other note stands.

**ADR-025 (2026-09-28, after an XHS warning about automated login/publish activity):** every publish first runs a **headless session preflight** (one `goto` + selector reads; the upstream launcher never creates a profile headless, so a missing profile is refused outright) — an unauthenticated session can no longer produce a headed window waiting out the 120 s login gate. Both console visits are then capped at **one headed publish cycle + one session check per 2 h** by `automation-guard.ts` (`~/.config/kk/xhs-automation.json`, override `KK_XHS_AUTOMATION_STATE`); the publish budget is consumed at the headed launch, so a refused preflight leaves the window intact and the operator can retry after logging in. `login` is never automated and never capped; a corrupt state file fails closed. The daily workflow's XHS target ships `xhs_enabled: "true"` (2026-09-29 operator decision; draft-only — `xhs_live` stays a launch-time switch).

`infoq-pub` (0185, ADR-027/E91) is the first of the four target channels built on the shared library: `InfoqBrowserTransport` is `kind: 'browser'`, `driver: 'script'` by default, and the `agent` driver fails fast (`unsupported driver 'agent' for infoq`). InfoQ's WAF 451s every headless load (measured 0191), so the `checkChannelSession` preflight runs **headed only** (`headedOnly: true`, 60 s budget) — an absent profile or an expired session returns `ok: false` naming `bun plugins/publishings/infoq-pub/src/profile-check.ts login` plus the profile dir path, and never a cookie, page HTML or stack — then opens `https://xie.infoq.cn/` through upstream `withProfilePage` (headed unless `options.headless === true`), dismisses the optional `知道了` feature notice, clicks `div.write-btn` and requires the URL to land on `/draft/<id>` (the entry creates the server-side draft; the id comes from that URL). It fills the title and the ProseMirror body through `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))` (E91-D4) plus one dispatched `input` event so autosave fires; the measured console has no summary field. No save control is clicked: the draft signal (E91-D6) is the autosave `已保存` indicator, read only from notification/save-status containers, within 30 s. `div.submit-btn` (`提交` — InfoQ's submit for editorial review, as the site has no self-publish) is clicked only when `content.metadata.publishStatus === 'public'` (E91-D5), any other value returns `ok: false` before a browser opens, and the live signal is a visible `提交成功`/`审核` toast or a URL that moved off the draft URL; no signal within 30 s returns `ok: false` naming the control and deadline, and a draft run never clicks `提交`. The Result is `{ ok, target: 'infoq', id?, url?, message, metadata: { driver, publishStatus, profileDir } }`, where `public` reports `infoq submitted for InfoQ editorial review`. Selectors (`writeEntry`/`noticeDismiss`/`title`/`body`/`live`) were measured by the 0191 draft dogfood (`docs/design/infoq-ui-discovery.md`). Operator CLI: `bun plugins/publishings/infoq-pub/src/profile-check.ts login|check|open [--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]` (`check` is headed-only via `checkHeadedOnly`) over the shared `runProfileCli` (exit 0 verified / 1 refused / 2 usage). Profile dir precedence: `--profile` or `options.profileDir` > `INFOQ_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir('infoq')`.

`juejin-pub` (0186, ADR-027/E91) is the second of the four target channels built on the shared library: `JuejinBrowserTransport` is `kind: 'browser'`, `driver: 'script'` by default, and the `agent` driver fails fast (`unsupported driver 'agent' for juejin`). Juejin's headless editor readiness is non-deterministic (measured 0192), so the `checkChannelSession` preflight runs **headed only** (`headedOnly: true`, 60 s budget) — an absent profile or an expired session returns `ok: false` naming `bun plugins/publishings/juejin-pub/src/profile-check.ts login` plus the profile dir path, and never a cookie, page HTML or stack — then opens `https://juejin.cn/editor/drafts/new?v=2` through upstream `withProfilePage` (headed unless `options.headless === true`) and fills the title and the bytemd CodeMirror body through `fillCodeMirror(page, SELECTORS.body, content.body)` as **markdown** (no HTML conversion, E91-D4). Juejin autosaves the draft: the flow gives the autosave its 5 s window, presses `Meta+S`/`Control+S` once when the page still showed nothing, and requires the observed signal (E91-D6) — a URL on `/editor/drafts/<id>` or a visible `保存成功` toast — before reporting `ok: true`, `publishStatus: 'draft'`, the observed URL and the URL-carried id; no signal within 30 s returns `ok: false` naming the label and the deadline. The live path runs only for `content.metadata.publishStatus === 'public'` (E91-D5; any other value returns `ok: false` before a browser opens) and needs `content.metadata.category` plus a non-empty `content.metadata.tags`: the popup's `确定并发布` cannot confirm without them, so a live run missing either returns `ok: false` naming the field **before** any browser opens. It then clicks `发布`, picks the `.category-list .item` whose text is exactly the category, types each tag with `Enter`, clicks `确定并发布`, and requires a `/post/`- or `/published/`-shaped URL or a visible `发布成功` toast; a draft run never clicks a live control. The Result is `{ ok, target: 'juejin', id?, url?, message, metadata: { driver, publishStatus, profileDir } }`. Selectors are the wt seed's `title`/`body`/`publish`/`category`/`tagInput`/`confirm` entries; the operator draft dogfood (0192) re-measures `EDITOR_URL`, those selector lists and the draft signal. Operator CLI: `bun plugins/publishings/juejin-pub/src/profile-check.ts login|check|open [--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]` (`check` is headed-only via `checkHeadedOnly`) over the shared `runProfileCli` (exit 0 verified / 1 refused / 2 usage). Profile dir precedence: `--profile` or `options.profileDir` > `JUEJIN_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir('juejin')`.

`substack-pub` (0187, ADR-027/E91) is the third of the four target channels built on the shared library: `SubstackBrowserTransport` is `kind: 'browser'`, `driver: 'script'` by default, and the `agent` driver fails fast (`unsupported driver 'agent' for substack`). The publication is required and publication-scoped (`SUBSTACK_PUBLICATION_URL`, or a per-run `options.publicationUrl`): the editor URL is that URL without its trailing `/` or `/publish`, plus `/publish/post` (the bare route; Substack rewrites it to `/publish/post/<id>` on autosave, the legacy `/publish/post/new` never does — measured 0193), so an unset, blank or non-`https:` publication returns `ok: false` naming the variable **before** any browser opens. The flow runs the same headless `checkChannelSession` preflight with `headedFallback: false` — an absent profile or an expired session returns `ok: false` naming `bun plugins/publishings/substack-pub/src/profile-check.ts login` plus the profile dir path, and never a cookie, page HTML or stack — then opens the publication's editor through upstream `withProfilePage` (headed unless `options.headless === true`) and fills the title, the optional `metadata.subtitle` and the ProseMirror body through `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))` as **rendered HTML** (E91-D4). Substack autosaves and rewrites the editor URL, so a draft run clicks nothing at all and success comes only from the observed signal (E91-D6): `ok: true`, `publishStatus: 'draft'`, the observed `/publish/post/<id>` URL and its id; no signal within 30 s returns `ok: false` naming the label and the deadline. The live path runs only for `content.metadata.publishStatus === 'public'` (E91-D5; any other value returns `ok: false` before a browser opens): it clicks `Continue`, then `Send to everyone now` — Substack's subscriber email — and requires a `/p/<slug>` or `/publish/posts/published` URL, so a draft run never clicks a live control. The Result is `{ ok, target: 'substack', id?, url?, message, metadata: { driver, publishStatus, profileDir } }`. Selectors are the wt seed's `title`/`subtitle`/`body`/`continue`/`send` lists; the operator draft dogfood (0193) re-measures the editor URL, those selector lists and the draft signal. Operator CLI: `bun plugins/publishings/substack-pub/src/profile-check.ts login|check|open [--publication <url>] [--profile <dir>] [--url <url>] [--timeout <ms>]` over the shared `runProfileCli` (exit 0 verified / 1 refused / 2 usage), taking the publication from `--publication` or `SUBSTACK_PUBLICATION_URL`. Profile dir precedence: `--profile` or `options.profileDir` > `SUBSTACK_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir('substack')`.

`x-pub` `article` (0188, ADR-027/E91) is the fourth target channel built on the shared library: `XArticleBrowserTransport` is `kind: 'browser'`, `driver: 'script'` by default, and the `agent` driver fails fast (`unsupported driver 'agent' for x article`). The flow runs a headless `checkChannelSession` preflight with `headedFallback: false` — an absent profile or an expired session returns `ok: false` naming `bun plugins/publishings/x-pub/src/profile-check.ts login` plus the profile dir path, and never a cookie, token, page HTML or stack — then opens `https://x.com/compose/articles` through upstream `withProfilePage` (headed unless `options.headless === true`), clicks the write control, fills the title (`content.title ?? 'Untitled'`; X mounts `textarea[placeholder="Add a title"]` only after its `[data-testid="twitter-article-title"]` display div is clicked, so the flow clicks it when the textarea is absent — measured 0194) and inserts the Draft.js body through `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))` as **rendered HTML** (E91-D4). The optional cover comes from `options.coverPath ?? content.metadata.coverImage` and must be an absolute path to an existing `.png|.jpg|.jpeg|.webp` file — anything else returns `ok: false` naming the path **before** any browser opens; when given, the hidden file input is filled with `uploadFile` directly (opening the add-photos picker first detaches X's handler — measured 0194), the visible `Apply` in X's "Edit media" crop dialog is clicked, and the cover must render in the composer (a non-avatar `twimg` image) within 30 s or the run returns `ok: false`. X autosaves the composer onto `/compose/articles/edit/<id>`, so success comes only from the observed signal (E91-D6): `ok: true`, `publishStatus: 'draft'`, that URL and its id; no signal within 30 s returns `ok: false` naming the label and the deadline. The live path runs only for `content.metadata.publishStatus === 'public'` (E91-D5; any other value returns `ok: false` before a browser opens): it clicks `Publish` and requires a URL that left `/edit/` and carries the article id, so a draft run never clicks the publish control. The Result is `{ ok, target: 'x', id?, url?, message, metadata: { operation: 'article', driver, publishStatus, profileDir } }`. Selectors are the `write`/`title`/`body`/`addPhotos`/`fileInput`/`publish` lists (`addPhotos` is kept declared but not clicked), re-measured by the 0194 draft dogfood (the seed's `tweetButton`/`Tweet` candidates are dropped — post-composer, tweet risk). Operator CLI: `bun plugins/publishings/x-pub/src/profile-check.ts login|check|open [--profile <dir>] [--url <url>] [--timeout <ms>] [--headed]` (`check` is headed-only via `checkHeadedOnly`, 0216) over the shared `runProfileCli` (exit 0 verified / 1 refused / 2 usage). Profile dir precedence: `--profile` or `options.profileDir` > `X_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir('x')`. The `post` operation is untouched: `XPostApiTransport` (API v2, OAuth 1.0a) stays `file-cli` and never opens a browser.

### `@gobing-ai/web-search` (`plugins/ingestions/web-search`, kind `ingestion`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `buildFixtureDocs(topic, maxResults)` | function | Canned `Doc[]` from fixture entries; `id` = sha256(`sourceUri`) hex prefix — deterministic per ingestion spec §2.3 |
| `parseInput(raw)` | function | Validates `--in` JSON per the 0054 contract; throws on invalid JSON / missing or blank `topic` / non-positive `maxResults` |
| `searchFirecrawl(input, deps)` | async function | Live Firecrawl `POST /v2/search` → `Doc[]` (task 0057, feature C4); throws fail-loud diagnostics — missing key / transport error / non-200 / malformed body / hits-but-no-usable-markdown. **C5 (ADR-013):** live path scrapes via `/v2/scrape` → `markitdown` → `references/<doc-id>.md` cache → normalized body; per-URL scrape failure warns and keeps the snippet body; existing cache file is reused |
| `scrapeAndCacheDocs(docs, deps, outPath)` | async function | Scrape → `markitdown` → `references/<doc-id>.md` cache → normalized body per Doc (C5, ADR-013); cache hit reuses the file without a new scrape; per-URL failure warns and keeps the snippet body |
| `FetchLike`, `SearchDeps`, `MarkitdownRunner` | type & interface | Injectable live-path dependencies — fetch signature, env, clock, scrape runner, markitdown runner — tests never hit the network or the real binary |
| `computeId(uri)` | function | sha256(`sourceUri`) 16-hex `Doc` id; exported so workflow local-Doc mapping stays consistent (0059) |
| `main()` | function | `--in`/`--out` IO per the ingestion spec §2; exit 0 success / 1 failure |

`--in` JSON (API source, ingestion spec §2.2): `{ "topic": string (required), "maxResults": int (default 8), "fixture": boolean }`. `fixture: true` selects the offline stub; absent/false runs the **live Firecrawl client** (task 0057, feature C4): requires `FIRECRAWL_API_KEY` (§3), zero hits writes `[]` exit 0, any failure exits 1 with no `--out` (fail loud). **C5 (ADR-013):** live mode additionally requires the `markitdown` binary on PATH (missing → exit 1 naming it); writes `references/` under the `--out` directory; `fixture: true` needs neither.

### `@gobing-ai/aihot-ingest` (`plugins/ingestions/aihot-ingest`, kind `ingestion`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `AihotItemSchema`, `AihotSnapshotResponseSchema`, `AihotChangesResponseSchema` | Zod schemas | Official default-field API shapes; changes are `upsert(item) \| remove(id)` records |
| `processIngestionIO(options, depsOverride?)` | function | Fetch selected snapshot/changes, retain `upsert` items, and atomically write `Doc[]` plus optional cursor state |
| `AihotClient`, `createAihotClient(deps?)` | class & function | Client with injectable `fetch` and optional warning sink; invalid individual records warn and skip |
| `mapAihotItemToDoc(item)` | function | Maps an article to `Doc`, retaining source links and Aihot attribution in metadata |
| `main(depsOverride?)` | function | Executor surface `--in <config.json> --out <docs.json>`; direct entry also accepts `--limit`/`--cursor`/`--state-file`; exit 0 success / 1 failure |

`--in` config: `{ "limit"?: integer (1–100, default 10), "cursor"?: non-empty string, "stateFile"?: non-empty path }`.

### `@gobing-ai/episode-plan-gen` (`plugins/generations/episode-plan-gen`, kind `generator`)

Curates the blended news `Doc[]` into the episode plan — the single upstream shared by the article,
the audio script, and the show notes.

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `planEpisode(docs, options)` | function | Full pipeline: `cleanBody` → `planScore` → URL dedup (`normalizeUrl`) → title dedup (`titleSimilarity`, bigram Jaccard ≥ 0.6) → top `maxItems` by score. Losers of either dedup are recorded on the winner's `metadata.mergedFrom` (`{source, title, url}`); English-dominant titles get `metadata.needsTranslation: true`; each survivor carries `metadata.planScore` |
| `cleanBody(text)` | function | Strip `⭐️ x.y/10` ratings, `### [title](url)` heading copies and `**「label」**` research-note section headings, collapse blank-line runs to one, trim |
| `normalizeUrl(url)` | function | Strip `utm_*`/tracking params and trailing slash for dedup keys |
| `titleSimilarity(a, b)` | function | Bigram Jaccard similarity (0–1), CJK-aware |
| `docsToContent(docs, options)` | function | Wrap the plan as markdown `Content` carrying the selected `Doc[]` in `metadata.docs` — the executor's generator contract output; the workflow extracts `metadata.docs` to `21-plan/plan.json` for downstream steps |
| `filterAnnotated(docs, config)` | function | Quality-controller gate (`--mode filter`, 0094): annotated `Doc[]` → `{ kept, rejected }`; survivor = category in the `QC_CATEGORIES` allowlist AND every `metadata.scores` dim ≥ its inclusive `QC_MIN_*` min (score == min passes); each `RejectedDoc` carries every failed check (`category:not-in-allowlist`, `quality:2<3`); missing/invalid annotations exit 1 naming the doc id; rejection audit at `<out>.rejected.json` as `{ rejected, config, total }`; zero survivors is a valid exit-0 (`metadata.docs: []`) |
| `main()` | function | Executor `--in`/`--out` `--mode plan\|filter`; mode precedence flag > `EPISODE_PLAN_MODE` env > `plan` (unknown value → exit 1 naming both sources); env `EPISODE_PLAN_MAX_ITEMS` (default 20), `EPISODE_PLAN_DATE`, `QC_*` (filter mode); exit 0 success / 1 failure |

Daily workflow wiring: `plan_max_items` (default `"20"`) caps selection; `plan-translate` (agent.run, gated by `plan_translate_enabled`) translates `needsTranslation` items in place before the article step consumes the plan. `DAILYNEWS_MAX_ITEMS` is no longer set by the workflow — the plan is the single limiter. `--mode filter` (0094) is wired into the workflow since 0097: the `quality-control-content` state runs it as `EPISODE_PLAN_MODE=filter` (`kk executor run` forwards only `--in`/`--out`, so the mode rides the env channel) with the `done-no-content` terminal + `qc_*` vars + rejection audit at `21-plan/candidates.rejected.json`. Task 0189 R2: after the filter, the stage also applies the topic-boundary admission pass (data-driven rules from `plugins/kk/scripts/topic-boundary.json` — political/diplomatic-trade, military, policy-dispute, social-event mainlines, plus a published-after-run-date date-conflict check) to the candidates, recording each exclusion with id/rule/matched keyword at `${run_date}_04_quality-control-content_exclusions.json` and rewriting the candidates in place; zero kept docs leaves the empty candidates for the `done-no-content` edge.

### `@gobing-ai/dailynews-gen` (`plugins/generations/dailynews-gen`, kind `generator`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `VoiceScriptSchema` | Zod schema | `{ title, language: "zh" \| "en", default_profile?, segments: [{ text, gap_ms?, instruct? }] }` |
| `processGeneratorIO(in, out, options?)` | function | Transform news `Doc[]` into validated VoiceScript YAML carried by markdown `Content` |
| `buildNewsVoiceScript(docs, options?)` | function | Construct VoiceScript with intro, story segments with `gap_ms`, and outro |
| `main()` | function | Executor `--in`/`--out`; options come from `DAILYNEWS_LANGUAGE`, `DAILYNEWS_TITLE`, `DAILYNEWS_DATE` (task 0189: `YYYYMMDD`/`YYYY-MM-DD` broadcast date for the greeting — a backfilled run must not greet the render date; garbled values warn and fall back to now), `VOICEBOX_DEFAULT_PROFILE`; direct flags override env; exit 0 success / 1 failure |

### `@gobing-ai/voice-gen` (`plugins/generations/voice-gen`, kind `generator`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `processGeneratorIO(in, out, client?, transcodeMp3?, generator?)` | function | Read Doc[], generate Voicebox audio Content, write out JSON + sibling WAV; optional ffmpeg MP3 when `VOICE_GEN_MP3` is set (D5/D13); `generator` (default `kk:voice-gen`) is stamped into `metadata.generator` so a sibling plugin can reuse the pipeline under its own tag (ADR-023) |
| `isMp3Requested(env?)` | function | Parse `VOICE_GEN_MP3` truthy values |
| `transcodeWavToMp3(wav, mp3)` | function | ffmpeg WAV → MP3 (`libmp3lame` `-qscale:a 2`) |
| `parseDocToVoiceScript(doc, envDefaultProfile?)` | function | Parse plain text or VoiceScript structure from Doc |
| `mergeVoiceScripts(scripts, docs, envDefaultProfile?)` | function | Merge multiple scripts into combined VoiceScript |
| `validateVoiceScript(script)` | function | Validate VoiceScript text/instruct caps, engine/language enums, and structure |
| `concatWavs(wavs, gapsMs?)` | function | Concat RIFF WAV buffers with optional gap silence |
| `createVoiceboxClient(opts?)` | function | Client factory for local Voicebox REST API |
| `main()` | function | CLI `--in`/`--out` entry point; exit 0 success / 1 failure |

`VoiceboxClient.transcribe` is optional (`transcribe?`); both call sites guard with
`typeof client.transcribe === 'function'` (ADR-023). `package.json` declares
`"exports": { ".": "./src/index.ts" }` so a sibling plugin can import the pipeline as a workspace
dependency.

### `omni-voice-gen` (`plugins/generations/omni-voice-gen`, kind `generator`)

Python (make + uv) plugin; not a Bun workspace package — `plugin.json` is the only manifest and the
executable `bin/omni-voice-gen` shebang wrapper is the whole spawn seam (§1.7). Public surface is the
`omni_voice_gen` package under `src/`:

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `__main__.main(argv?)` | function | CLI `--in`/`--out` entry; exit 0 success / 1 failure with `omni-voice-gen failed: <msg>` on stderr (any `pipeline.run` exception); lazy `pipeline` import |
| `pipeline.run(in_path, out_path, backend?, transcoder?)` | function | voice-gen `processGeneratorIO` port: delete-then-render (stale `--out`/`.wav`/`.mp3` removed at start and on failure); empty `Doc[]` → notice Content with no model load; D4 profile order, ≤2 verify retries (fidelity < 0.15 / loudness dip; seed pins attempt 0 only), `VOICE_GEN_MAX_RUN_MS` between segments, `VOICE_GEN_FAIL_ON_QC`, `VOICE_GEN_MP3`; single validated `--out` write (`metadata.generator: "kk:omni-voice-gen"`, D8.2 duration basis) |
| `contract.Doc` / `contract.Content` | pydantic models | Mirror `@gobing-ai/kk-core` Doc/Content (unknown fields stripped, zod parity) |
| `contract.parse_doc_list(raw)` | function | Parse `Doc[]` JSON; raises `ValueError` with the reason on any violation |
| `contract.content_to_json(content)` | function | 2-space-indent JSON, nulls dropped (voice-gen `JSON.stringify` parity) |
| `contract.NOTICE_CONTENT` | constant | Empty-input notice `Content` (`format: "markdown"`, title `Notice`) |

Quality gate: `make coverage` (pytest + per-file line/function >= 90% via `scripts/coverage_gate.py`);
`make lint` (ruff). All pipeline modules shipped (tasks 0121–0125). The `kk-daily-ai-voice` workflow
selects the generator via the `vdriver` var (default `gemini` (gemini-tts, 2026-09-29 operator override); swap to omni-voice-gen with
`--vars '{"vdriver":"ominivoice"}'`, or opt into the standalone VoxCPM driver with
`--vars '{"vdriver":"voxcpm"}'` — its spoken rate measured 5.19 字/秒 on the 2026-10-15
production episode); see `docs/design/omni-voice-gen.md`, `docs/design/voxcpm-daily-voice-driver.md`.

### `@gobing-ai/gemini-tts` (`plugins/generations/gemini-tts`, kind `generator`)

Hosted backend adapter over voice-gen's pipeline (ADR-023): the only backend-specific code is the
`VoiceboxClient` implementation; VoiceScript parsing, verify-retry, speed, concat, QC, and MP3 stay
voice-gen's. Depends on `@gobing-ai/voice-gen` (`workspace:*`); `scripts/bundle-plugins.ts` inlines
that import into the shipped `dist/index.js`.

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `main(argv?)` | function | CLI `--in`/`--out` entry; calls `processGeneratorIO(in, out, geminiClient, undefined, 'kk:gemini-tts')`; missing args exit 1 |
| `createGeminiVoiceClient(opts?)` | function | `VoiceboxClient` over `POST {GOOGLE_BASE_URL}/v1beta/interactions` (`x-goog-api-key`); `health()` asserts the key + model allowlist with no network; `resolveProfile` passes `voice_…`/`voicekey_…` through and maps names via `GEMINI_TTS_PROFILES`/`profiles.json`; `generate` sends `speech_config` voice + `speech_metadata` style and buffers the decoded 24 kHz mono s16 WAV; `waitUntilDone` completes immediately; `downloadAudio` returns and evicts; `transcribe` omitted when `GEMINI_TTS_ASR=off` |
| `GEMINI_TTS_MODELS` / `GEMINI_TTS_DEFAULT_MODEL` / `GEMINI_ASR_DEFAULT_MODEL` | constants | `['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']`; defaults `gemini-3.8-flash-tts` / `gemini-3.8-flash` |

Operator helper `src/voice-create.ts` (run directly with `bun`, not a `kk` subcommand):

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `main(argv?, deps?)` | function | `--source --consent --name` plus optional `--store` (`true`\|`false`, default `true`) and `--model` (default `GEMINI_TTS_MODEL`, else `gemini-3.8-flash-tts`); prints the created `voice_…` id on stdout, exit 1 on any validation/API failure without echoing the key |
| `validateVoiceWav(bytes, role)` | function | Throws unless RIFF PCM 24 kHz mono 16-bit; `source` must also be 10–30 s. The message names the actual rate/channels/bits/duration |
| `createReplicatedVoice(opts)` | function | `POST {GOOGLE_BASE_URL}/v1beta/voices` `{store, voice:{model, type:'replicated', display_name, replicated:{source_audio, consent_audio}}}` with base64 WAV; returns `{ id }` |

Runbook (consent clip, renewal, profile-map wiring): `plugins/generations/gemini-tts/README.md`,
`docs/design/gemini-tts.md` §4.

### `@gobing-ai/voxcpm-tts` (`plugins/generations/voxcpm-tts`, kind `generator`)

Standalone VoxCPM generator (ADR-036): the only backend-specific code is the `VoiceboxClient`
adapter — VoiceScript parsing, gaps, speed, concat, QC, and MP3 stay voice-gen's. Depends on
`@gobing-ai/voice-gen` (`workspace:*`) and ships an independent uv project (`pyproject.toml` +
`uv.lock`, `voxcpm==2.0.3` on Python 3.12) plus a private NDJSON worker `python/worker.py` the
adapter spawns as `uv run --project <plugin-root> --locked --no-dev python python/worker.py`.
`scripts/bundle-plugins.ts` inlines the TypeScript import into `dist/index.js`; the worker,
project files and `profiles.json` ship as copied assets. `vendors/` is never a runtime path.

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `main(argv?, options?)` | function | CLI `--in`/`--out` entry; creates the adapter, calls `processGeneratorIO(in, out, client, undefined, 'kk:voxcpm-tts')`, closes it (worker/signals/scratch) in `finally`; missing args exit 1 |
| `createVoxCpmClient(opts?)` | function | Invocation-scoped adapter `{ client, scratchDir, close() }`: lazy `uv` worker spawn (argv array, no shell), bounded integer-id NDJSON health/render (1 MiB frames, 64 KiB stderr), one in-flight render, terminal on malformed framing/timeout/exit, process-group teardown; `health` loads at most one model |
| `parseVoxCpmRegistry(raw, dir)` | function | Validate the frozen `profiles` registry (unique ids/names, per-mode required fields, relative assets, vendor exclusion) |
| `resolveVoxCpmWorkerCommand(pluginRoot)` | function | `uv run --project … --locked --no-dev python python/worker.py` |
| `assertNoVendorPath(path, label)` | function | Canonical vendor exclusion for every configured path (including symlinks) |
| `VOXCPM_TTS_GENERATOR` / `VOXCPM_DEFAULT_MODEL` / `VOXCPM_DEVICE(S)` | constants | `kk:voxcpm-tts`; `openbmb/VoxCPM2`; `auto`/`cpu`/`cuda`/`mps` |

Runbook (`VOXCPM_MODEL`/`VOXCPM_DEVICE`/`VOXCPM_PROFILES_PATH`, profile modes, control policy):
`plugins/generations/voxcpm-tts/README.md`; frozen spec `docs/design/voxcpm-daily-voice-driver.md`.

### `@gobing-ai/podcast-pub` (`plugins/publishings/podcast-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `PodcastPubTransport` | class | `file-cli` transport: Bearer REST client + two-phase presigned upload (audio, then optional local episode cover as `image/png`); requires `MICROFEED_BASE_URL`, `MICROFEED_API_KEY`; `publish` accepts additive assembly options `{audioFile, coverPath, durationSec}` (plugin merges article + audio + cover itself, L1 R6) |
| `mapContentToEpisode(content)` | function | Maps Content to episode fields: `title`, `contentHtml` (sanitized HTML — markdown showNotes/body rendered via the closed-dialect renderer in `show-notes.ts`; `format: 'html'` bodies pass through), `status`, `audio` (`metadata.audioUrl` or `metadata.audioPath`/`audioFile`), `durationSeconds`, `imagePath` (non-http `coverImage`), `imageUrl` (http cover); throws `unsupported audio MIME type "<type>" for Apple Podcasts: expected one of <list>` when the resolved audio MIME (after any `metadata.mimeType` override) is outside the Apple allowlist `audio/mpeg`, `audio/x-m4a`, `audio/mp4`, `video/mp4`, `video/quicktime`, `video/x-m4v` — refused before any network call (0170) |
| `resolveAudioMimeType(ref, mimeType?)` | function | Extension → audio MIME mapping with override |
| `getPublishTransport()` | function | Returns `FakeFileCliTransport` when `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake`, else `PodcastPubTransport` |
| `processPublishIO(inputPath, outputPath, transport?)` | function | `--in`/`--out` IO per the publish spec §1; supports `options.operation` (`publish`, `show-notes`, `list`, `get`, `update`, `delete`, `validate`); a bare Doc[] `--in` selects `show-notes` and writes the markdown file to `--out` (render options via `PODCAST_PUB_TITLE` / `PODCAST_PUB_RUN_DATE` / `PODCAST_PUB_ARTICLE_BASE_URL` / `PODCAST_PUB_BRIEF_MODE` / `PODCAST_PUB_ARTICLE_POST_PATH`) |
| `renderShowNotesMarkdown(docs, opts)` | function | Renders plan Doc[] → show-notes markdown (L1 R6 port of the workflow's inline renderer): `# title`, per-item `## N.` sections capped at two 。！？ sentences, `[来源：…]` links, full-article footer (default base `https://surfing.salty.vip`); with `articlePostPath` (0118) the footer is `<base>/<locale>/posts/<postSlug>` derived O(1) from the published path, else the legacy fallback `<base>/zh/posts/<runDate>-<slug>`; `briefMode: true` + a postPath renders the timeline layout (`HH:MM` briefs, per-item `[文章]` link); golden-fixture byte-pinned in the plugin tests |
| `main()` | function | CLI `--in`/`--out` entry point; exit 0 success / 1 failure |

### `@gobing-ai/knowledge-kit` (`apps/cli`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `createProgram()` | function | Side-effect-free Commander factory |
| `runInvoke(opts)` | function | Invoke execution & contract validation engine |
| `bin: kk` (alias `knowledge-kit`) | binary | `dist/index.js` — Bun-target bundle staged by `prepack` (ADR-010) |
| published `dependencies` | manifest | `scripts/publish.ts` rewrites `catalog:` to the root catalog range and strips private `workspace:*` (kk-core) so `bun add -g @gobing-ai/knowledge-kit` can resolve; repo manifests keep `catalog:` (ADR-014) |

## 5. Spur project config (harness)

File: `.spur/config.yaml`

| Key | Value |
| ----- | -------- |
| `name` | `knowledge-kit` |
| `bootstrap.database.driver` | `bun-sqlite` |
| `bootstrap.database.url` | `.spur/spur.db` |

## 6. Design specifications

| Specification | Path | Description |
| --------------- | ------ | ------------- |
| Ingestion Plugin Specification | `docs/design/ingestion-plugin-specification.md` | Generic plugin authoring contract + Ingestion Plugin specification |
| Generator Plugin Specification | `docs/design/generator-plugin-specification.md` | Generator-kind authoring contract: Doc[]→Content mapping, owned STORM engine (D4), failure semantics |
| Publish Plugin Specification | `docs/design/publish-plugin-specification.md` | Publish-kind authoring contract: transport abstraction, Content→frontmatter mapping, Result conventions, generic §1 citation |
| Fan-In / Fan-Out Specification | `docs/design/fan-in-and-fan-out-specification.md` | `kk executor fan-in` / `kk executor fan-out` CLI surface, merge + dedupe semantics, concurrent non-serial dispatch, `--target-timeout` tree kill, aggregate partial-success `Result`, exit codes, `--retry-from` (task 0033; concurrency enforced 0248) |
| kk product CLI surface | `docs/design/kk-cli-surface.md` | Operator binary `kk`, two-noun tree `executor` + `plugin` (A21 / ADR-011 **shipped** 2026-08-12); A2 bin/help/register tree **shipped** 2026-08-12 |
| Web automation on the engine | `docs/design/web-automation-engine.md` | `web-automation` skill (discover/enhance/automate; cached-login profiles, stealth launch) + the proposed `@gobing-ai/ts-dual-workflow-engine` transition-flow with `auth` var, preflight/session-probe guards, HITL fresh-login node, startable `drive` re-entry, and confidence-gated verdicts (`confidence: HIGH\|MEDIUM\|LOW` required; missing/out-of-enum blocks — skill shipped 20261006; workflow = planned feature task) |
| STORM evidence cache | `docs/design/storm-evidence-cache.md` | `references/` cache in the 0056 layout, Firecrawl `/v2/scrape` → `markitdown` → body, digest-don't-index report contract (C5 / ADR-013 **shipped** 2026-08-16) |
| ITC generating skill | `docs/design/itc-generating.md` | Fat agent skill `itc-generating` + four distilled references, generic craft & platform playbooks (F3 **shipped** 2026-08-19) |
| Voice generator | `docs/design/voice-gen.md` | Voice generator plugin over local Voicebox REST API (D5 **shipped** 2026-08-19) |
| Solo-podcast workflow | `docs/design/kk-solo-podcast.md` | Product state-machine over voice-gen: HITL outline + VoiceScript + WAV (F5 **shipped** 2026-08-20) |
| Aihot news ingestion | `docs/design/aihot-ingest.md` | Ingestion plugin fetching curated AI news items from aihot.virxact.com into Doc[] (F6 **shipped** 2026-08-21) |
| Daily news generator | `docs/design/dailynews-gen.md` | Generator plugin compiling news Doc[] into broadcast VoiceScript Content (F6 **shipped** 2026-08-21) |
| Daily AI voice workflow | `docs/design/kk-daily-ai-voice.md` | Product state-machine: one collect state (fan-in --source: aihot-ingest + last30days-ingest + horizon-ingest) -> core-facts-gen -> plan (episode-plan-gen + plan-translate) -> content QC (episode-plan-gen filter via EPISODE_PLAN_MODE; empty kept set -> done-no-content) -> article + cover + dailynews-gen script + the `${vars.vdriver}` voice driver (`gemini` -> gemini-tts default (2026-09-29), `voicebox` -> voice-gen, `ominivoice` -> omni-voice-gen, `voxcpm` -> voxcpm-tts (opt-in, ADR-036); unknown alias fails loud) -> publish (podcast-pub show notes + surfdash-pub/podcast-pub fan-out; failed targets -> publish-partial); daily audio defaults to MP3 with ID3 tags (0171), and `intro-music` joins from the raw render to a distinct `.intro.wav` output (0176) (F61 destination; restructured 2026-09-06 by 0097); the `xhs-write`/`xhs-publish` pair appends a Xiaohongshu card draft (lead-item card plan agent.run -> pinned `xhs-card` x `xhs-knowledge` presets -> `kk stage daily-xhs-render` -> `kk stage daily-publish-xhs`, draft unless `xhs_live`) as an independent, non-blocking target that never enters `publish_status` (E8); the `wechat-publish` state appends a WeChat MP draft (article → `kk stage daily-publish-wechat` → `wechatmp-pub` console browser transport, draft unless `wechat_live`) on the same independent, non-blocking terms (2026-09-29); a publishing run (`publish_enabled`) passes the `safety-review` → `safety-judge` verdict gate between `script` and `review`/`wrap-docs` (0189 R10: `kk stage daily-safety-prep <work_dir> <run_date> <platforms>` + `kk:content-safety` agent.run + `kk:content-judge` compliance agent.run + `kk stage daily-safety-gate <work_dir> <run_date> <safety_max_revise>` → `safety_status` pass\|escalate\|exclude\|revise\|block; the safety `review`/`judge` agent actions tolerate a failed run (`onError: continue`, 0270) so a missing/malformed report still reaches the fail-closed gate, `revise` stays failure-tolerant, and the deterministic prep/gate shells keep default-fail so the nested machine aborts loudly (0270); the safety verdict must carry a `HIGH\|MEDIUM\|LOW` confidence level — missing or out-of-enum values block (20261003); 20261005 the gate adjusts instead of halting: `revise` loops the drafts through `safety-revise` (`kk:content-safety` detect+revise agent.run + `kk stage daily-safety-revise`, budget `safety_max_revise`, default 2) back into `safety-review`, `exclude` drops the admission-blocked platforms from the run and publishes the rest (the stamp's `excludedPlatforms`, honoured by the per-target stages), escalate always pauses at `review` (20261007 operator decision: on the disposition contract only a finding marked `disposition:"escalate"` escalates — a report with no `disposition` field anywhere keeps the legacy any-RISK/escalate pause, fail-closed; gap/note/fix-class RISK on a clean pass lands in `exclude` at recorded risk with empty `excludedPlatforms`; a disposition-contract report must carry report-level `HIGH\|MEDIUM\|LOW` confidence — missing or out-of-enum blocks (20261007 amendment, ADR-033 R5)), and `daily-publish-prep` refuses drafts without a matching pass\|escalate\|exclude digest stamp — only draft-integrity findings (a PII finding on a blocked platform, or a must-pass `fail` outside the admission criteria), an out-of-contract verdict, or edited-after-review drafts reach `failed`); on a `block` the drafts are quarantined to `24-script/.quarantine-<run_date>-judge-block/` instead of being deleted, and the run continues to its normal terminal, so a rejected draft stays on disk for inspection rather than being re-judged in place (20261005); `kk stage daily-publish-completeness <work_dir> <run_date>` (called in `run-report`'s onEnter, terminal join point) records the independent channels' state (en/ja locales, XHS, WeChat, surfdash CMS re-sync) in `31-publish/<run_date>_17_publish_completeness.json` and warns on any gap — those channels never enter `publish_status`, so a hand-driven tail that skips them is otherwise invisible (20261003; 0220 moved out of classify into terminal stage)|
| kk-collect workflow | `docs/design/kk-collect-and-daily-voice2.md` §3, §5 | Product state-machine for standalone 6-hourly collection (task 0208, G31): `lock` (`kk ledger sync` + `kk stage collect-prepare` workspace composition + `kk lock acquire`, a held claim routes `skipped`) → `collect` (`kk executor fan-in --source` aihot/last30days/horizon with the 45 m horizon leash + `kk stage daily-collect-facts`) → `store` (`kk store ingest`) → `label` (`kk store label --run … --new-ids …`, task 0209 — heuristic-first decision labels) → `release` (`kk lock release`; the run's ledger section is written by the next tick's `kk ledger sync`, since an in-run `append` always refuses a `running` trace); `collect`/`store`/`label` failures route to `release-failed` (a state-machine aborts on a failed action without transitioning, so those actions continue-on-error behind a positive-artifact guard) so the lock is never left behind. The `label` guard reads the pass verdict through the confidence-aware `jq` filter (task 0213, G31 R14): only `verdict: PASS` with a `HIGH|MEDIUM|LOW` confidence reaches `release`, and a missing or out-of-enum level is refused by name and routed to `release-failed` — fail-closed without deadlocking. Collection only: it never generates, renders audio or publishes, and the store is the sole state it shares with the daily workflow. `plugins/kk/schedules/` + `kk schedule render` provide the operator-installed 6 h launchd/cron trigger **shipped (task 0208)** |
| kk-collect + daily voice2 | `docs/design/kk-collect-and-daily-voice2.md` | `@gobing-ai/kk-store` (ts-db SQLite, `store.db_path`, boundary rules), `kk store migrate\|lock\|ingest\|backfill-facts\|label\|extract\|select\|mark-published\|release`, `kk ledger append\|sync\|cutover-check`, `kk schedule render`, kk decision catalog + extraction profiles, 6h `kk-collect` state-machine, `kk-daily-ai-voice2` DAG (ADR-030/031, features G31 / G11 / G71 — **shipped**; G11 by tasks 0211–0212, first green dogfood run `4a9b22f0` 2026-10-08; 0237 turns the episode speech into an opening + one section per item + closing, cached per section under `30-audio/sections/<date>/` and joined by ffmpeg before the intro sting, with a pre-spend character-rate estimate calibrated to the measured driver rates; 0238 gives the two hard-fail `agent.run` producers `onError: continue` plus a `-retry` sibling on `agent_retry` and makes every `21-plan/<date>_03_plan_plan.json` reader depend on both; the episode window is the var pair `episode_min_minutes`–`episode_max_minutes`, default 15–25 since 2026-10-09, and it drives **both** the estimate and the measured `daily-episode-duration` gate; since 2026-10-15 (ADR-036 amendment) voice2 defaults to `vdriver: "voxcpm"` and runs a three-tier voice chain — `generate` (the var), `generate-fallback` (gemini), `generate-fallback2` (omni) — where each fallback is gated on the pool count plus the absence of a valid upstream render, and `intro` waits on all three) |
| Daily voice script plan | `docs/design/daily-voice-script-plan.md` | `script-write` agent.run -> per-item script plan (intro/outro/lead/insight) under a checked-in style contract; dailynews-gen validates + builds from it, template fallback stamped `scriptSource` in the run report (F613 **shipped** 2026-09-25 by 0161+0162: `kk stage daily-script-style` snapshot, `script_write_enabled`+zh guarded `script-write` state with `onError: continue`, `NEWS_REPORT_SCRIPT_FILE` -> `脚本来源` line) |
| Image-gen runtime fallback | `docs/features/D6_image-gen-runtime-fallback.md` | Opt-in `metadata.imageGen.fallback` on the image-gen envelope: absent = strict fail-fast (one provider, original error), `true` = retry down AUTO_ORDER (minus NEVER_AUTO), a list = retry in exactly that order; `metadata.attempts` records every failed provider try `{image, provider, model, errorClass, message}` (present only when non-empty), policy rejections never fall back, and each paid retry is WARN-logged on stderr first (D6 **shipped** 2026-09-25 by 0164–0166) |
| Daily news cover stage | `docs/design/kk-daily-ai-voice.md` | `kk stage daily-cover <work_dir> <run_date> <plugins_path> <provider> <model> <fallback>`: reads the lead-item subject brief, writes the image-gen `--in` envelope pinned to the shipped `daily-news-cover` format x `daily-news` style (subject is the only per-run var, `maxImages: 1`), and runs `kk executor run image-gen`; a missing/invalid brief logs a fallback reason and renders the format's default subject (F614 **shipped** 2026-09-25 by 0163); an empty `<fallback>` (the `cover_fallback` var default) keeps strict fail-fast, `true`/a comma list opts into D6 runtime fallback (0166) |
| Daily XHS card stages | `docs/design/kk-daily-ai-voice.md` §7 (voice1) · `docs/design/kk-collect-and-daily-voice2.md` §6 (voice2's `note_scope` / `podcast`) | `kk stage daily-xhs-render <work_dir> <run_date> <plugins_path> <count> <style> <provider> <model> <fallback> [<note_scope>]`: validates the agent-written card plan (count vs `xhs_cards`, cover-first, per-field caps), renders one card per `kk executor run image-gen` call sequentially through the pinned `xhs-card` format x the `<style>` preset (default `xhs-knowledge`), reuses a card whose recorded artifact is still on disk, and packages `25-xhs/cards.json` + `25-xhs/content.json` with `metadata.images` in image order and `metadata.publishStatus: draft`. The optional `<fallback>` arg (0219, `xhs_fallback`, shipped `"true"`) is the cover stage's opt-in (0219 R1, shared `imageFallback` parse: `''`/absent keeps strict fail-fast, `'true'` retries down image-gen's AUTO_ORDER, anything else is a candidate list); a card whose `image-gen` call fails stops the loop with `xhs render: card <NN> failed … re-run daily-xhs-render to resume from card <NN>` and exits with the child's status (0219 R2) — with one carve-out (0251): when the failure stderr names a compose safe-area overflow on `points[n]` fields only, the stage shortens those points (cut at the last non-final `。`/`！`/`？`, else keep 36 code points + `…`; nothing shortened means no retry), rewrites `25-xhs/cards/card-<NN>.in.json` in the same envelope shape, and retries image-gen once via the stderr-capturing `kkCaptured` sibling of `kk()` before taking the same stop; 0269 adds the companion carve-out — a failure the overflow sentence does NOT explain is the provider's, so the SAME envelope is retried once (the 2026-10-12 loss was a vendor flake on the call right after an overflow rewrite, and that exact saved envelope rendered first try by hand), while a failure that persists through both calls still stops the series, so a broken card costs one extra illustration and not the run's whole budget. `<note_scope>` (0235, voice2 passes `episode`) addresses the 上传图文 note to the whole episode: the packaged set appends the episode cover `23-cover/<date>_07_cover_cover.png` last when it exists (a 3:4 card 01 leads because image 1 sets the note's grid ratio; the set stays ≤ `XHS_MAX_CARDS` + 1, inside xhs-pub's `XHS_IMAGE_MAX` 18) and the body becomes the agent's lead paragraph (hashtags split off), then one numbered line per attached image in attach order — a card's `copy` + its first `points` entry, the cover `每日AI乱炖 <date> 本期封面` — then the hashtags; over `XHS_NOTE_BODY_MAX` (1000) only the lead is trimmed, never a numbered line, and a body that still overflows fails before the first card is rendered (nothing billed), and a missing cover logs `xhs render: no episode cover at <path> — the note carries the <N> cards only` without failing (R1/R2). A plan card's optional `itemId` (voice2's per-item content cards) is recorded on its `cards.json` entry. Absent or any other `<note_scope>` keeps the lead-item series and the agent's body byte-for-byte, which is what voice1 packages (R4). `kk stage daily-publish-xhs <work_dir> <run_date> <plugins_path> <live> [<podcast>]`: resolves `draft`|`public` from `<live>` (`xhs_live`, ADR-022) and runs `kk executor run xhs-pub` (default `script` driver, ADR-024), soft on failure and cached per requested status (a cache hit logs each recorded follow-up that did not complete — `publish-xhs cached: follow-up <operation> did not complete: <error>` — and never re-visits, since a re-visit would post a second 图文 draft). `<podcast>` (0236, voice2 passes `true`) attaches the episode's 发播客 note to the packaged note as `metadata.followUps`, built from the run's own `31-publish/<date>_13_publish-prep_content.json` — the final mp3 (`metadata.audioFile`, repeated as `metadata.audio`, the key `xhs-pub`'s 发播客 mode reads) and `23-cover`'s `metadata.coverImage`, plus `metadata.operation: "发播客"` and the run's `publishStatus`; a run with no such prep output logs `publish-xhs: no publish-prep Content at <path> — the 发播客 note is skipped` and carries the 图文 note alone, and a call without the trailing arg packages the 图文 note byte-for-byte as before (voice1). The pair is an independent, non-blocking target: it never contributes to `publish_status` (E8). `xhs_enabled` ships **on** (2026-09-29 operator decision, ADR-025 amendment; draft-only), and the plugin additionally enforces a headless session preflight plus a 2h publish/check cap (ADR-025) |
| Daily AI voice gap analysis | `docs/design/kk-daily-ai-voice-gap-analysis.md` | Gap analysis vs ideal 3-stage daily pipeline (F61 task 0088) |
| Ingestion source adapters | `docs/design/ingestion-source-adapters.md` | last30days + Horizon external-CLI adapter briefs to Doc[] (F61 task 0089) |
| Core-facts template & blend contract | `docs/design/core-facts-template.md` | Core-facts markdown template and fan-in merge contract prototype (F61 task 0090) |
| Article & publish fan-out brief | `docs/design/article-publish-fanout-brief.md` | content-gen home, podcast show notes, and single-state fan-out brief (F61 task 0091) |
| kk-itc end-to-end | `docs/design/kk-itc-end-to-end.md` | kk-itc auto/HITL path, `kk stage itc-*` publish tail, target profile table, draft-default switch per target (F41 **shipped** 2026-09-22, ADR-021/ADR-022) |
| XHS image cards | `docs/design/xhs-image-cards.md` | XHS card series skill (`kk:xhs-images`), format `xhs-card`, style `xhs-knowledge`, ordered Content images, `xhs-pub` script-driver draft/public (E8 **shipped** 2026-09-25, ADR-024) |

## 7. Workflow resolution (run-anywhere) and `/workflow-run` surface

Product workflows are authored under `plugins/kk/workflows/` (ADR-009 amendment — **design-time
SSOT**, packed in the npm tarball's `plugins/`). `/workflow-run` **runs the YAML in place** from
any cwd — no copy on the happy path. The `kk` package root is resolved from the binary itself
(`command -v kk` + symlink walk), so it works under bun/npm/nvm/homebrew prefixes.

### 7.1 Resolution order

| Priority | Path | Notes |
| -------- | ---- | ----- |
| 1 | `$workflows_dir/$NAME.yaml` (default `~/.config/kk/workflows/`) | User override — wins when present; nothing is copied |
| 2 | `$KK_WORKFLOWS_SOURCE/$NAME.yaml` | Environment override root |
| 3 | `$(dirname $(bun pm bin -g))/install/global/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows/$NAME.yaml` | bun global install (guarded probe) |
| 4 | `$(dirname $(npm root -g))/node_modules/@gobing-ai/knowledge-kit/plugins/kk/workflows/$NAME.yaml` | npm global install (guarded probe) |
| 5 | `$pkg/plugins/kk/workflows/$NAME.yaml` | Installed package copy (resolved from the `kk` binary) |
| 6 | `plugins/kk/workflows/$NAME.yaml` | Repo checkout (development) |

**Semantics:**

- First hit wins; the resolved YAML is run **in place** — never copied on the happy path.
- `--force` → refresh the user override (priority-1 path) from the best available source, then run the override.
- To customize a workflow, copy it to `$workflows_dir/` (or use `--force`) — the override wins on every later run.
- Source missing from all roots → exit 1, stderr lists every searched root.
- Sidecars the machine executes are **not** copied. Daily-voice actions and the ITC tail use `kk stage <stage> [args…]`: the verb resolves `plugins/kk/scripts/kk-workflow-stages.ts` by entry identity (0178). A recognized checkout entry runs the checked-in source runner; missing source fails instead of loading the staged `apps/cli/plugins/` copy. An installed entry runs its own package-shipped copy. If the package candidate is absent, only a genuine checkout may use the module-anchored source fallback, never cwd (0157 R4). The verb spawns `bun <script> <stage> [args…]` with inherited stdio and exit-code passthrough. Legacy solo-podcast actions, ITC prepare and storm-research actions still resolve `$pkg/plugins/kk/scripts/kk-workflow-stages.ts` directly, with a cwd-relative fallback; 0178 does not change those calls. The runner resolves sidecars (`validate-voicescript.ts`, `wrap-voicescript-doc.ts`, `render-md.ts`) as explicit var → `$KK_WORKFLOWS_DIR` → the runner's scripts dir → `$HOME/.config/kk/workflows`.

### 7.2 `/workflow-run` command surface

```text
/workflow-run [name] <topic|--in file> [--dir <path>] [--playbook generic|english|wechat]
             [--research] [--judge] [--outline <a|b|c>] [--writer itc-generating|topic]
             [--auto] [--unslop true|false] [--max-revisions <N>] [--cover] [--inline-images]
             [--targets <a,b>] [--live] [--source-locale en|zh|ja]
             [--duration <min>] [--language <code>] [--script-approved]
             [--publish <true|false>] [--last30days <true|false>] [--skip-review]
             [--fixture] [--force]
```

| Profile | Target workflow | Workspace layout | Report artifacts |
| ------- | --------------- | ---------------- | ---------------- |
| `kk-storm-research` (default) | `kk-storm-research.yaml` | `$works_dir/kk-storm-research/<topic-id>` (0056 hash) | `$work_dir/content.md`, `$work_dir/content.json` |
| `kk-itc` | `kk-itc.yaml` | `$works_dir/kk-itc/<kebab>` (topic authoring) | `$work_dir/brief.md`, `$work_dir/2-outline/outline-approved.md`, `$work_dir/3-draft-draft-article.md`, `$work_dir/4-publish/` (`content.json`, `content.<variant>.json`, `publish-plan.json`, `fanout-result.<variant>.json`, `result.<target>.json`; publish tail runs), `$work_dir/5-report/report.md` + `report.json` (auto runs); F41 shipped 2026-09-22 (ADR-021/ADR-022) |
| `kk-solo-podcast` | `kk-solo-podcast.yaml` + `validate-voicescript.ts` + `wrap-voicescript-doc.ts` | `$works_dir/kk-solo-podcast/<date>` | `$work_dir/1-briefing-briefing.md`, `$work_dir/3-script-voicescript.yaml`, `$work_dir/4-audio/content.json`, `$work_dir/4-audio/content.wav` |
| `kk-daily-ai-voice` | `kk-daily-ai-voice.yaml` | `$works_dir/kk-daily-ai-voice/<date>` | `$work_dir/22-article/<date>_06_article_article.md`, `$work_dir/24-script/<date>_08_script_voicescript.yaml`, `$work_dir/30-audio/<date>_11_generate_content.json` (with `metadata.mp3Path` — 0171), `$work_dir/<date>_19_run-report_report.md` |

**`kk-itc` auto mode (0149):** three vars extend the HITL authoring pipeline without changing its default path: `auto` (`false`), `unslop` (`false`), `max_revisions` (`2`). Under `auto` the writer also writes `2-outline/outline-recommendation.json`; `kk stage itc-outline-pick` validates it and the pick is bound as the selected outline (no select pause), `draft-review` is skipped, the judge is mandatory, and NEEDS_REVISION loops through `draft-autorevise` (`.auto-revise-count`, capped at `max_revisions`) instead of failing; the interactive NEEDS_REVISION verdict now routes to `draft-revise` with the judge feedback shown, still capped at 3. `unslop` inserts a `kk:taste-unslop` in-place de-slop pass before review/judge. Every run under `auto` ends in the `report` state: `kk stage itc-report` writes `5-report/report.{md,json}` `{outcome, verdict, revisions}` and the outcome routes to done/failed. Both helpers live in `plugins/kk/scripts/itc-stages.ts` (node builtins only, dispatched from the shared runner switch). The judge gate only accepts a `PASS` that carries a `HIGH|MEDIUM|LOW` confidence: the guards read the verdict through a confidence-aware `jq` filter that renders an out-of-contract `PASS` as `PASS!`, which the out-of-contract catch-all routes to `failed` instead of publishing, and `kk stage itc-report` reports `outcome: failed` for such a verdict rather than depending on that routing (20261003; same contract as `daily-safety-gate`, pattern in `plugins/kk/skills/content-judge/references/workflow-integration.md`).

**`kk-itc` DAG entry, config and publication contract (G21 / ADR-040, tasks 0298–0303):** `plugins/kk/workflows/kk-itc.yaml` is now a version-2 `kind: dag`; authoring lives in the `kk-itc-author` child state machine (`plugins/kk/workflows/kk-itc-author.yaml`) whose terminal `author-finish` state writes `<workDir>/.itc/author-complete.json` `{schemaVersion,parentRunId,childRunId,draftDigest,outlineDigest,judgeDigest|null,reviewMode:'manual'|'judged',status:'complete'}`. The DAG nodes are topic intake → prepare → `child-author` → `verify-child-freeze` → the optional `illustrate` branch (node `condition` on `cover_enabled`/`inline_images`) and `adapt` (`kk:article-adapt`) → `adapt-verify` → `check-targets` → `send-confirm` → `fanout-send` → `fanout-recovery` → `reconcile-settle`, with `seo` and `report` depending only on `verify-child-freeze` so an all-skipped publication subtree still reports.

Native ITC stages (all through the `kk stage run` dispatcher; `apps/cli/src/`): `itc-plan.ts` (`PublishPresetSchema`, `resolveItcTargets`, `buildItcPublishPlan`), `itc-topic.ts` (`itc-topic-extract|validate|select`, `itc-selection-settle`), `itc-decision.ts` (`itc-decision` with ≤1800-UTF-16-unit evidence compacting), `itc-publish.ts` (`itc-materialize-plan`, `itc-check-targets`, `itc-send-targets`, `itc-reconcile-receipts`, `itc-export-seo`, `itc-report-summary`, `itc-author-verdict`) and `itc-config.ts` (`resolveItcOptions`, `resolveItcWorkspace`, `verifyItcOptionsSnapshot`).

*Capability-driven targets.* A publish plugin declares `publishing {defaultProfile, profiles{format, locale, limits, requires, modes{draft|live:{metadata}}}}` in its `plugin.json`; `PublishingCapabilitiesSchema` (`packages/kk-core/src/manifest.ts`) validates it strictly and only for `kind: publish`, and discovery carries it on `PluginRecord.publishing`. `buildItcPublishPlan` resolves variants and complete mode bindings from those declarations — the central `TARGET_PROFILES` table is gone. Editoral presets are strict JSON (`plugins/kk/publish-presets/<slug>.json`) resolved project-first (`.kk/publish-presets/<slug>.json`) then package, with a present-but-malformed override failing rather than falling through. Selection precedence is explicit `--targets` > `--publish-preset` > `workflows.kk-itc.publish_preset` > topic-profile `publishPreset` > none; exact duplicates collapse, conflicting profiles for one plugin are refused.

*Isolated payloads and receipts.* `itc-materialize-plan` writes `4-publish/content.json` plus one `4-publish/content.<plugin>.json` per target, clearing the profile's mode-key union (`operation`/`published`/`publishStatus`/`private`/`mode`) before stamping that target's complete metadata map. `itc-send-targets` dispatches each target through the existing `kk executor fan-out` (browser targets via `--serial-target`) and writes `4-publish/receipts/<plugin>.json` `{schemaVersion:1,parentRunId,planDigest,payloadDigest,plugin,profile,mode,attemptId,status:'succeeded'|'failed'|'uncertain',effect:'none'|'confirmed'|'unknown',resultDigest?,aggregatePath,publicUrlVerified?}`. A successful invocation is a success even for a draft save, so `mode` stays explicit and a URL alone never proves a live public page: only plugin-owned `Result.metadata.itcDelivery` evidence (schema `{schemaVersion:1,effect,publicUrlVerified?}`) may strengthen the observation, and failed `Result.metadata` is now preserved by `fanout.dispatchOne`. `--retry` re-sends only `effect:'none'` failures; confirmed successes and uncertain rows are never replayed. `itc-export-seo` admits only live-mode, confirmed, `publicUrlVerified` URLs into `seo/published-pages.json` and otherwise records `not-assessed` with an empty list.

*Config and workspace.* `resolveItcOptions(launch, context)` strictly validates `workflows.kk-itc` — a missing config uses compiled defaults and ITC never creates one; a malformed file, an unknown declared key or a wrong-typed value throws naming the key/file and never the value, before any mkdir. Precedence is explicit per-option flag > `--auto` implied default (research/judge/unslop only, and only when not explicitly supplied) > declared env override (`KK_CONFIG`/`KK_WORKS_DIR`) > `workflows.kk-itc` > compiled default. `--playbook wechat` implies `zh` only without an explicit source locale. Workspaces are `<worksRoot>/kk-itc/<slug>` with `YYYYMMDD` appended when dated; a full `--dir` override wins; a relative `works_dir` resolves against the config's directory and only a leading `~` expands. The frozen `ItcEffectiveOptions` snapshot (`itc-options.json`) carries the digest of every declared non-secret value, and a resume verifies it with `verifyItcOptionsSnapshot` — a changed ambient config is a refusal, never a silent directory or publication-intent change. Collected-topic sources resolve as `status: 'intake'` with `workDir: null` until the topic is selected.

*Board (G8/0254 amendment).* The ITC revision projection reads the `draft-revise`/`draft-autorevise` visits of the **authorized child** run (`authorizeItcChild` requires `author-run.json` to bind the parent run id, the expected `<parentRunId>-author` child id and the executed definition digest) and falls back to the parent's own `states[]` projection for historical single-FSM captures. Missing or mismatched child evidence yields `board.itc.child-unverified` with **null** revision counts, never a synthetic zero.

**`kk-itc` publish tail (0150/0151):** four launch vars extend the pipeline when publishing is in scope: `publish_targets` (empty = no publish tail), `publish_live` (`false`; live is never implied by auto), `source_locale` (`en`) and `browser_target` (internal file-cursor var). With targets set, judge PASS and draft-review yes route into `publish-entry` → `materialize` → `publish-plan` → `publish-gate`, and four more `itc-stages.ts` helpers own the work: `itc-materialize` writes the final draft to `4-publish/content.json` (`metadata.published` always a boolean); `itc-publish-plan` splits the targets into `kk executor fan-out` groups and browser targets in `4-publish/publish-plan.json` — the `<source_locale>-article` variant shares `content.json`, every other locale/format variant gets `content.<variant>.json`, and `itc-publish-fanout` stamps each variant's draft/live switches into the file metadata at send time (V3) and spawns one `kk executor fan-out --content <variant> --target … --out 4-publish/fanout-result.<variant>.json` per group — per-target failures stay data (`ok:false` aggregate rows plus the `.fanout-failed` marker), and `--retry` re-sends only failed groups once via `--retry-from` (`.publish-retry-count` caps at 1); `itc-publish-next` writes the `4-publish/.next-browser` cursor and the `publish-agent` self-loop runs one `agent.run kk:publish` per pending browser target (`4-publish/result.<target>.json`), bounded by the plan's browser list. `publish-gate` pauses at the `publish-confirm` HITL unless `auto ∧ ¬publish_live` (ADR-022); a declined answer routes to report with outcome `declined` and no publish call. `itc-report` then adds each target's ok/url/error plus the exact `kk executor fan-out --retry-from …` command for failed groups; any `ok:false` makes the outcome `failed`.

**`kk-itc` illustrations + per-variant adaptation (0152):** two spend vars extend the tail: `cover_enabled` (`false`) and `inline_images` (`false`) — image generation is billed work, so it runs only when a var turns it on (R7). With either on, `publish-entry` routes into the `illustrate` state, whose `agent.run` invokes `kk:image-authoring` with `KK_NONINTERACTIVE=1 KK_IMAGE_AUTO_CONFIRM=1` to write `4-illustrations/cover.*` (plus `inline-*` figures when `inline_images=true`); a follow-up shell step fails when `cover_enabled=true` yielded no cover, and `itc-materialize` then picks the cover up into `metadata.coverImage`. After `publish-plan`, the `adapt` state runs only when the plan has an `adapt:true` variant (shell guard on `publish-plan.json`): its `agent.run` invokes the new thin skill `kk:article-adapt` (`plugins/kk/skills/article-adapt/`), which writes one Content file per `adapt:true` variant — translating `title`/`body` to the variant locale, applying the plan's `limits`, and keeping code blocks, URLs and `references` unchanged. The skill holds no platform table (the plan is the single SSOT) and never sets draft/live switch keys — `itc-publish-fanout` stamps them at send time (V3). A follow-up `kk stage itc-adapt-verify` step fails by name when a variant file is missing or lacks a non-empty `title`/`body`; the plan-time rejection of 0151 moved there, since `adapt` runs after `publish-plan` (design §3).

**`kk-itc` end-to-end profile flags (0153):** the `/workflow-run` kk-itc profile gains `--auto`, `--unslop true|false`, `--max-revisions <N>`, `--cover`, `--inline-images`, `--targets <a,b>`, `--live` and `--source-locale en|zh|ja`, binding the 0149–0152 vars end to end: `--auto` also defaults `research`, `judge` and `unslop` to `true` unless passed; `--live` binds `publish_live=true` only when passed explicitly (ADR-022 — `--auto` alone leaves `publish_live` false); `--playbook wechat` without `--source-locale` implies `zh`; the rest bind their same-named vars (`publish_targets`, `cover_enabled`, `inline_images`, `max_revisions`, `source_locale`).

Workspaces default to `$works_dir/<workflow-name>/<run-id>` per profile (`--dir` overrides). Existing `.works/`-era trees (flat `<kebab>`/`<topic-id>` dirs under `$works_dir`) are **not** migrated — rerunning against an old workspace requires an explicit `--dir`.

**`kk-daily-ai-voice` work_dir composition (0146):** headless callers (the 06:00 cron) pass only `run_date`; the daily-prepare stage composes the workspace as `$works_dir/kk-daily-ai-voice/<yyyymmdd>` (digits-only stamp — retried/resumed runs re-derive the same directory) and writes the effective path to the anchor file `.spur/runs/kk-daily-ai-voice/work-dir.txt`, which the workflow reads back into `vars.work_dir`. An explicit `--dir` still wins (manual profile), and `run_date.txt` mirrors the digits-only stamp so later stages glob artifacts deterministically. Composition roots at `works_dir` resolution: `$KK_WORKS_DIR` → config `works_dir` → `$HOME/.config/kk/works`.

**`kk-daily-ai-voice` MP3 enclosure + ID3 (0171):** `transcode_mp3` defaults to `"true"`, so `daily-generate` hands the voice driver `VOICE_GEN_MP3=true` and the voice Content carries `metadata.mp3Path`; `kk stage daily-publish-prep <work_dir> <run_date> [artist] [album]` publishes that MP3 and fails loud (exit 1) when the resolved audio is not `.mp3`, naming `transcode_mp3` — the WAV render never reaches podcast-pub. It then stamps ID3v2.3 `title` (article `title`), `artist` (`podcast_artist`, default `Robin Min`), `album` (`podcast_album`, default `咸话咸说`) and `date` (`run_date` as `YYYY-MM-DD`) with `ffmpeg -c copy` (no re-encode) into `<audio>.id3.tmp.mp3`, renames that over the original, and fails the stage when ffmpeg fails; an empty artist/album var omits that tag. The stamp runs after intro-music, whose mp3 re-transcode would otherwise strip tags stamped earlier.

### 7.3 `/tell-me` command + `explain-things` skill surface

| Capability | Source path | Installed ID |
| ---------- | ----------- | ------------ |
| Fat skill | `plugins/kk/skills/explain-things/SKILL.md` (+ one-level `references/views.md`) | `kk:explain-things` |
| Thin slash wrapper | `plugins/kk/commands/tell-me.md` | `/tell-me` (`kk-tell-me`) |

Signature: `/tell-me [topic] [--eli5]`. The command carries routing metadata only (`allowed-tools:
["Skill"]`) and its sole operative line is `Skill(skill="kk:explain-things", args="$ARGUMENTS")`;
empty arguments forward unchanged so the skill owns conversation-topic fallback (else it stops with
a recovery instruction before creating any artifact). View selection — pseudocode / call tree /
component tree / file tree / Mermaid / diff / copyable block, with one focused HTML artifact as
last resort — lives in the skill body + `references/views.md`. No alias commands, no subagent, no
first-layer `kk` noun (F9; ADR-009 / ADR-011).

## image-gen compose block + composed-card artifact (2026-10-01, task 0180, ADR-028)

Compose formats are format presets carrying a `compose` block. Schema (zod-validated in
`@gobing-ai/image-gen`):

```yaml
formats:
  - name: xhs-card
    width: 1080
    height: 1440
    compose:
      engine: text-card          # only engine shipped; unknown engine fails loud
      safeArea: 72               # px inset all [data-field] boxes must respect
      headlineMinPx: 64          # every headline starts at 1.5x this floor and steps down to it
      bodyMinPx: 36
      illustrationHeight: 640    # top band; 0 hides the band (text-only cards)
      palette: { background: '#FFFFFF', text: '#1F2328', accent: '#FF2442' }
      fonts: { headline: NotoSansSC-Bold.otf, body: NotoSansSC-Regular.otf }
```

Behavior: `compose(headline, points, role, compose, fontBytes, illustrationBytes?) -> PNG` is a
pure function (byte-identical for identical inputs, SHA-256 verified); text is typeset with the
pinned Noto Sans SC SubsetOTF fonts from `assets/fonts/` through headless Chromium (Playwright,
local, no network); overflow beyond `safeArea` fails loud naming the field. Non-compose formats
(`free`, `cover`, `daily-news-cover`, `illustration`) are unchanged.

Artifact: for compose formats the job returns `ImageArtifact` with `.path` = composed card PNG
and `.illustration = { path, bytes, width?, height? }` = raw provider output (written beside the
card as `<stem>-illustration<N>.<ext>`). Consumers (daily XHS stages, `xhs-pub`) read only
`.path`. Pre-spend: font cmap coverage fails loud naming field + code point;
`KK_IMAGE_DRY_RUN=1` runs the full pre-spend path (cmap check + text-only compose) without
provider spend. E2E evidence: `bun plugins/generations/image-gen/scripts/compose-e2e-artifact.ts`
(1080x1440 + SHA-256 determinism per variant); the bun-test E2E case skips under `bun test` with
a printed reason (Bun 1.3.14 event-loop block during Chromium launch).

Task 0181 (F616 R1) — text-free prompt contract: for compose formats the composed provider prompt
must stay text-free. `assertTextFreePrompt` (in `@gobing-ai/image-gen`'s compose module) refuses
pre-spend (dry runs included, before any font IO) when the prompt or any named contributor carries
a Han character, the headline, or any point as a literal substring (trimmed, length ≥ 2; numerals
and ordinary Latin words are fine), and the error names the offending segment (`the format
template`, `the style preset '<name>'`, `spec.extra`, `vars.<name>`) or falls back to `the
composed prompt`. The shipped `xhs-card` template states the text-free rule and `xhs-knowledge`
carries `negative: text, letters, numbers, Chinese characters, captions, watermark, logo`; the
daily `xhs-render` stage sends no `language` var and records each card's `illustrationPath` in
`cards.json`.

## image-gen preset canvas: exact-size gate + delivered-size recording (2026-10-02, task 0182)

Format presets declare a pixel canvas (`width`/`height` in `presets/formats/*.yaml`), but before 0182
only `aspectRatio` ever reached the provider. Task 0182 makes the declaration truthful: the declared
canvas reaches a provider that can honour it, and every written artifact records what was actually
delivered.

**Exact-size rule:** `ImageProvider.exactSize?(model, width, height): boolean` gates forwarding per
adapter and model. When the preset declares both edges and the resolved provider reports the
capability for the resolved model, the request carries `width`/`height` with `aspectRatio` omitted
(MiniMax reads width/height only when `aspect_ratio` is absent); otherwise the request keeps the
byte-identical aspect-only shape — no new validation failure for any existing preset × provider
pair. The gate runs per fallback candidate with that candidate's own model (D6: the primary's
`spec.model` never leaks to a candidate), so an exact-capable primary falling back to an aspect-only
provider records `sizeRequest: 'aspect'`. Only MiniMax `image-01` opts in today (512..2048 per edge,
divisible by 8); every other adapter keeps the default (absent method = aspect-only) until it opts
in on measured evidence.

**Delivered-size recording:** every written `ImageArtifact` records the delivered `width`/`height`,
measured from the bytes by `imageDimensions` (`src/bytes.ts` — header-only, no decode: PNG IHDR,
JPEG SOFn, WebP VP8/VP8L/VP8X; unparseable bytes return `null`, not a throw), plus
`sizeRequest: 'exact' | 'aspect'`. A declared canvas that comes back different emits
`WARN image-gen: <provider>/<model> delivered <WxH>; format '<name>' declares <WxH>`; unparseable
bytes omit the dimensions and emit one WARN instead. Both warn only — the bytes are already paid
for, and failing would delete them through the cleanup path. On the compose path the card keeps
0180's canvas assertion (an unparseable composed card still fails loud); the raw provider delivery
lands on `illustration.width/height` beside the card.

## Repository workflow discovery

Workflow files: `plugins/kk/workflows/` is canonical, including `feature-verification.yaml`.
`.spur/workflows` is a relative symlink to `../plugins/kk/workflows`; existing workflow paths remain
valid and Settings → Workflows discovers the plugin definitions via the project layer.
