---
name: Design
doc: 04_DESIGN
owns: "SURFACE — concrete shapes: every CLI command, flag, config key, env var, table, DTO"
authority: derived
version: 2.42.0
created_at: 2026-07-22
updated_at: 2026-10-05
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
| [kk-cli-surface.md](design/kk-cli-surface.md) | Operator `kk` binary + two-noun tree | shipped (A2/A21) |
| [fan-in-and-fan-out-specification.md](design/fan-in-and-fan-out-specification.md) | Sequential `executor fan-in` / `fan-out` | shipped (B6) |
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
| [kk-daily-ai-voice-gap-analysis.md](design/kk-daily-ai-voice-gap-analysis.md) | Gap analysis vs ideal end-to-end daily pipeline | research (F61) |
| [ingestion-source-adapters.md](design/ingestion-source-adapters.md) | last30days + Horizon ingestion adapter briefs (Doc[] mapping) | research (F61) |
| [core-facts-template.md](design/core-facts-template.md) | Core-facts markdown template & blend contract prototype | prototype (F61) |
| [article-publish-fanout-brief.md](design/article-publish-fanout-brief.md) | Article generator home, podcast show notes, and fan-out shape brief | research (F61) |
| [omni-voice-gen.md](design/omni-voice-gen.md) | OmniVoice-backed (PyPI) Python voice generator plugin, drop-in for voice-gen | shipped (F611) |
| [kk-itc-end-to-end.md](design/kk-itc-end-to-end.md) | kk-itc idea → research → judge-gated draft → per-platform drafts (HITL + auto) | shipped (F41) |
| [gemini-tts.md](design/gemini-tts.md) | Gemini 3.8 TTS voice generator: hosted backend adapter over voice-gen, drop-in via `vdriver: gemini` | shipped (F612) |
| [xhs-image-cards.md](design/xhs-image-cards.md) | XHS card skill, image-gen presets, ordered Content images, browser draft/public Result | shipped (E8, ADR-024; 0167 xhs-pub script transport, 0168 xhs-images skill + presets) |

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
```

| Command | Description | Status |
| --------- | ------------- | -------- |
| `executor run <plugin>` | Invoke a plugin with input/output files and contract validation | shipped (A21) |
| `executor fan-in` | Merge N `Doc[]` files into one (§1.5) | shipped (A21) |
| `executor fan-out` | Dispatch one `Content` to N publish targets in sequence (§1.6) | shipped (A21) |
| `plugin status` | List discovered plugins grouped by kind with per-plugin health (`--kind` filter, `--json` report) | shipped (A21) |

> **Surface status.** Rows marked *shipped* are live in `apps/cli` (transcribed from the code
> registrations). The first-layer nouns are exactly `executor` and `plugin` (ADR-011, feature
> **A21**); the engines shipped with **A2** / **B6** keep their flags and exit codes, only the
> canonical paths changed. Hidden one-release aliases `invoke` / `fanin` / `fanout` / `plugins *`
> still reach the same engines but are not listed in `kk --help`. §1.5/§1.6 are callable today. The
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

### 1.8 `stage` — shipped (F8; task 0133)

`kk stage <stage> [args…]` runs one stage of the shared workflow stage runner
(`plugins/kk/scripts/kk-workflow-stages.ts`) with positional pass-through, so workflow shell steps
do not re-resolve the script path themselves. Unknown options are allowed and forwarded. The exit
code is the stage's own; a non-zero code throws `CommanderError` (`kk.stage.failed`). It is a
first-layer noun **in addition to** `executor` / `plugin` (ADR-011 amendment 2026-09-18). The runner
is resolved by entry identity (task 0178): a **checkout entry** — the source marker
`apps/cli/src/stage.ts` exists and the real package root is that checkout's `apps/cli` — always
executes the checked-in source runner, so a divergent copy staged under `apps/cli/plugins/` (a
gitignored artifact) is never loaded and editing the runner takes effect without restaging; an
**installed entry** keeps its own package-shipped runner regardless of cwd, and the module-anchored
source fallback applies only to a genuine checkout whose package copy is missing. Runner and sidecar
resolution, and the delegated stage names, are in §7.

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
| `OMNIVOICE_PROFILE_REGISTRY` | no (omni-voice-gen) | Path to the JSON profile registry (profile name → `{ref_audio, ref_text}` clone / `{prompt}` saved clone prompt / `{instruct}` voice design); default `<plugin>/profiles.json`. Unknown profile name → exit 1 naming the profile (D4) |
| `OMNIVOICE_MODEL` | no (omni-voice-gen) | HuggingFace model id loaded via `OmniVoice.from_pretrained` (default: `k2-fsa/OmniVoice`) |
| `OMNIVOICE_DEVICE` | no (omni-voice-gen) | Torch device map override (default: auto — CUDA > MPS > CPU) |
| `OMNIVOICE_SPEED` | no (omni-voice-gen) | Speech speed multiplier (default: `1.0`) |
| `OMNIVOICE_ASR_MODEL` | no (omni-voice-gen) | ASR model for the post-generation fidelity check (default: unset → omnivoice default whisper) |
| `MICROFEED_BASE_URL` | yes (podcast-pub) | Base URL for self-hosted microfeed REST API (e.g. `https://<instance>.workers.dev`) |
| `MICROFEED_API_KEY` | yes (podcast-pub) | microfeed named API key (`mf_…`) with write scope |
| `MICROFEED_TIMEOUT_MS` | no (podcast-pub) | Request / upload timeout in ms (default: `300000`) |
| `SUBSTACK_PUBLICATION_URL` | yes (substack-pub) | Publication the Substack editor URL is derived from: the URL without its trailing `/` or `/publish`, plus `/publish/post/new`. Unset, blank or non-`https:` → `ok: false` naming this var before any browser opens (there is no default publication — `substack.com/new` picks an arbitrary one). A per-run `options.publicationUrl` (or the CLI's `--publication <url>`) wins |
| `KK_BROWSER_PROFILE_DIR` | no (x-pub `article`, xhs-pub, juejin-pub, infoq-pub, substack-pub) | Shared fallback browser profile dir for the `script` browser transports; a per-channel override wins (`X_PROFILE_DIR` / `XHS_PROFILE_DIR` / `JUEJIN_PROFILE_DIR` / `INFOQ_PROFILE_DIR` / `SUBSTACK_PROFILE_DIR`). Tiers are resolved by `resolveChannelProfileDir(channel, override)` (`@gobing-ai/publish-harness/browser`, ADR-027); blank values count as unset. Default `~/.config/kk/browser-profiles/<channel>` (`resolveBrowserProfileDir`) |

### Request timeouts

Bun's `fetch` — like WHATWG `fetch` — has no overall request deadline unless a `signal` is passed, so
a stalled peer would hang a workflow step until someone killed the run (task 0156 R5). Every plugin
HTTP call therefore passes `signal: AbortSignal.timeout(<ms>)`, sourced from one module-level
constant per plugin:

| Constant | Value | Scope |
| -------- | ----- | ----- |
| `PROVIDER_REQUEST_TIMEOUT_MS` | `300_000` | Every `image-gen` provider call. Declared in `src/providers/timeouts.ts` (a leaf module) and re-exported from `src/providers/types.ts` — it cannot live in `types.ts` directly, because that file builds the `PROVIDERS` registry from value imports of each adapter, so the constant would create a `types.ts ⇄ <adapter>` runtime cycle (TDZ on `create` for consumers that import an adapter first) |
| `ProviderOptions.timeoutMs` | optional | `image-gen` only, `@internal` test hook: providers resolve the timeout as `options?.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS`, so a test can drive the abort path without waiting 300s |
| `REQUEST_TIMEOUT_MS` | `120_000` | One per plugin in `aihot-ingest`, `web-search`, `emdash-pub`, `medium-pub`, `qiita-pub`, `x-pub` |
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

> **0177:** the persistent-browser launcher moved out of this package into `@gobing-ai/ts-browser-automation` (`openPersistentBrowser` / `loginWithProfile` / `withProfilePage`); xhs-pub binds it directly. `launchPersistentBrowser` was removed — no in-repo consumer remains.

#### `@gobing-ai/publish-harness/browser` (`packages/publish-harness/src/browser.ts`)

Shared browser command library behind the `./browser` sub-path export (ADR-027, E91). Plugins that
only need the package root (`src/index.ts`) never load this module or
`@gobing-ai/ts-browser-automation` (R5).

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `ChannelBrowserConfig` | interface | `{ channel, homeUrl, isAuthenticated, loginTimeoutMs? }`; `isAuthenticated` is the site-owned readiness predicate, `loginTimeoutMs` defaults to `180000` |
| `ChannelSessionResult` | interface | `{ status: 'verified' \| 'refused', profileDir, detail }`; the detail carries the profile dir path only, never credentials or profile content |
| `resolveChannelProfileDir(channel, override?)` | function | `override` > `<CHANNEL>_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir(channel)`; blank tiers count as unset, no directory is created |
| `checkChannelSession(config, opts)` | function | Read-only headless probe (`homeUrl` + predicate), one headed retry unless `headedFallback: false`; a missing profile is refused immediately and never created |
| `runProfileCli(config, argv?, deps?)` | function | `login\|check [--profile <dir>] [--timeout <ms>]`; `login` is headed `loginWithProfile`, `check` is `checkChannelSession`; exit 0 verified / 1 refused / 2 usage error, one line per message through the injected `stdout` |
| `waitUntil(predicate, timeoutMs, pollMs = 500)` | function | Poll to the deadline, then one final predicate call |
| `resolveSelector(page, selectors, opts?)` | function | First **attached** candidate of a selector list, polled to `timeoutMs`; throws naming `label` (default `selector`), every candidate and the deadline — the selector lists themselves stay site-owned in the plugin (E91-D3) |
| `pasteHtml(page, selector, html, opts?)` | function | Synthetic `ClipboardEvent('paste')` carrying `text/html` + `text/plain`, then asserts the editor text is non-empty |
| `fillCodeMirror(page, selector, markdown, opts?)` | function | CodeMirror 6 `view.dispatch` → CodeMirror 5 `CodeMirror.setValue` → `keyboard.insertText`, then asserts the editor text is non-empty |
| `uploadFile(page, selector, filePath, opts?)` | function | Attached `input[type=file]`; visibility is not required |
| `expectOutcome(probe, { timeoutMs, label, pollMs? })` | function | `{ ok: true, evidence }` or `{ ok: false, error }`; success only from an observed browser signal (E91-D6) |
| `markdownToHtml(markdown)` | function | `Bun.markdown.html` (E91-D4) — GFM tables, fenced code, task lists; no markdown dependency |
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
| `infoq-pub` | browser · `script` | Implement | No public write API; ProseMirror editor at `xie.infoq.cn/write` |
| `juejin-pub` | browser · `script` | Implement | No public write API; bytemd editor (CodeMirror, markdown) |
| `substack-pub` | browser · `script` | Implement | No public write API; ProseMirror editor, HTML paste |
| `x-pub` `article` | browser · `script` | Implement | No Articles API; `x.com/compose/articles`, HTML paste + cover upload |
| `x-pub` `post` | `file-cli` (API v2, OAuth 1.0a) | Keep | Official, deterministic, headless; browser posting invites anti-bot flags |
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

The 2026-09-29 refactor replaced the HTTP `draft/add` transport (which needed `WECHAT_APP_ID`/`WECHAT_APP_SECRET` and a `thumbMediaId`) with a console browser flow (xhs-pub pattern): the console's `新的创作` menu opens the editor for the requested **operation** — 文章 (`createType=0`), 贴图 (`8`), 视频 (`5`), 播客 (`7`) — on `/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=<N>&token=<session>…`, **in a new tab**. The body is the main-frame `div.ProseMirror` (the iframe UEditor is retired); the title is the ProseMirror block carrying `data-placeholder="请在这里输入标题"` — `textarea#title` is a hidden mirror, so filling it alone saves an empty title. Per-mode limits: title 文章 `0/64`, 视频/播客 `0/20`; author `input#author` `0/8` (原创-gated); digest `textarea#js_description` `0/120`. 视频/播客 start behind a modal media dialog that **covers the save bar**, so the artifact must be attached first and a missing artifact fails before any browser opens. Save is `保存为草稿`; `发表` is the publish control and is never clicked on a draft run. The draft signal is the `草稿箱` row's `更新于` timestamp (auto-save is continuous, the URL does not change, and `系统繁忙，请稍后再试` is not a failure). The cover comes from a body image (`从正文选择`; the panel states 默认首图为封面) because the editor exposes no cover file input, and `一键排版` → `匹配目标格式` applies the platform layout.

| operation | `createType` | required artifact | title |
| --------- | ------------ | ----------------- | ----- |
| `article` (文章) | 0 | body image (cover source) | required |
| `image-text` (贴图) | 8 | ≥1 image | optional |
| `video` (视频) | 5 | one video | `0/20` |
| `podcast` (播客) | 7 | audio + cover | `0/20` |

An undeclared `operation` fails by name before any browser or profile work. Live console evidence, selectors and the drift list: `docs/design/wechatmp-ui-discovery.md`. A save without an observed `.weui-desktop-toast` within 15 s is a loud failure — the plugin never reports success it did not see. `src/profile-check.ts login|check` owns the one-time QR sign-in (`~/.config/kk/browser-profiles/wechatmp`). No ADR-025 automation-guard: WeChat has issued no automated-activity warning; the headless preflight + draft default are the guard (conscious simplification). The daily workflow wires it as the `wechat-publish` state (`wechat_enabled: "true"`, draft-only — `wechat_live` stays a launch-time switch, outcome never enters `publish_status`). Draft metadata enrichment (2026-09-29): `metadata.wechatmp` drives post-save field filling in the editor — 合集 collection + cover are automated; every enrich step is commit-verified via `evalJs` DOM checks (v4), so a step that reports success but does not stick becomes a loud `enrichWarnings` entry (and a dialog sweep) instead of silent false-success. 原创+作者 (the author is bound to the 赏账户 search, headless-unresolvable), 赏, 原文链接 and 创作来源 (checkbox does not stick headless) remain manual in the draft box. Audio embed (2026-09-29): the daily MP3 is wired by the stage as `metadata.wechatmp.audioPath/audioTitle/audioCoverPath`; `insertAudio` opens the editor audio menu via JS click (hover dropdown), dedupes against the 素材库 by whitespace-stripped title (3 retries while rows stream in), inserts the found material at the caret (placed at the article start) and verifies placement top via evalJs; a missing material warns for manual upload (the 上传音频 form is iframe-based, unmapped). The collection is a workflow var (`wechat_collection`, arg 5 of `daily-publish-wechat`); the stage appends a WeChat-only closing line (【咸话咸说】 platform pointer) to the input body and resolves `workDir` to an absolute path (plugin child cwd = plugin dir, relatives would ENOENT).

### `@gobing-ai/x-pub` (`plugins/publishings/x-pub`, kind `publish`)

| Export | Kind | Notes |
| -------- | ------ | ------- |
| `XPostApiTransport` | class | `file-cli`: OAuth 1.0a `POST /2/tweets`; no browser fallback |
| `XArticleBrowserTransport` | class | `browser` / `driver: script`; headless session preflight, `x.com/compose/articles` Draft.js composer; observed `/compose/articles/edit/<id>` or fail-loud |
| `oauth1Header` | function | User-context OAuth 1.0a Authorization header |
| `processPublishIO` / `main()` | function | `--in`/`--out`; `options.operation` `post` (default) or `article` |

### Leftover CMS browser plugins (`juejin-pub`, `infoq-pub`, `substack-pub`, `xhs-pub`)

Each is `kind: publish`, `PublishTransport.kind: 'browser'`. Offline tests use `FakeBrowserTransport`. Profile dir `~/.config/kk/browser-profiles/<channel>`. A missing or expired session is `Result.ok false` in one line naming the operator login command and the profile dir path — never a stack, cookie, or page HTML (ADR-027 channels; the shared `checkChannelSession` refusal).

`xhs-pub` (0177) opens its browser through `@gobing-ai/ts-browser-automation`: `makeDefaultOpenPage` defaults to the typed upstream `openPersistentBrowser` (`defaultLauncher`, exported so the binding is provable offline), retaining its injectable launcher function and `OpenPage` seam. It closes the context if page setup fails; otherwise the publish flow owns closure. The profile helpers inject the upstream `BrowserLauncher` object (`{ launch({ profileDir, headless }) }`). Headless never fabricates a session — upstream refuses with `BrowserProfileMissingError`. In a source checkout, `src/profile-check.ts` provides the operator CLI: `bun plugins/publishings/xhs-pub/src/profile-check.ts login|check [--profile <dir>] [--timeout <ms>]` — `login` opens the headed creator console for a one-time sign-in, `check` verifies the saved session read-only and headlessly (exit 0 verified / 1 refused). Profile dir precedence: `--profile` > `XHS_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir('xhs')`.

`xhs-pub` (image cards) defaults to `driver: 'script'` — ordered card images are uploaded with Playwright `setInputFiles` (`Upload ordered card images` in `docs/design/xhs-image-cards.md`); the `agent` driver fails fast (`unsupported driver … requires the script driver`). The flow follows the live console as measured 2026-09-25 (task 0174): the in-viewport 图文 tab is force-clicked first and doubles as the login gate; the image input is a hidden `input[type="file"][accept*=".jpg"]` found by attachment (not visibility); previews are counted as `img.preivew-image`; the body is TipTap ProseMirror and is typed rather than value-set; and the submit bar's `暂存离开`/`发布` controls live in the **closed** shadow root of `<XHS-PUBLISH-BTN>`, so they are resolved through CDP box models and clicked at the measured centre (a driver without CDP fails loud). Draft completion is confirmed only from a delta against the pre-entry baseline (the console's draft counter moved, or a `保存于<timestamp>` entry appeared that was not already there) — XHS autosaves uploads, so a merely readable counter is not evidence; an unobserved outcome is reported as a failure, never as success.

`xhs-pub` (2026-10-05, ADR-029 / feature Q) declares four operations instead of one image-text path: `image-text` (≤18 images), `video` (one video file), `long-article` (no upload — authored **in place from the markdown**, then `一键排版` → `匹配目标格式`; `导入链接` is excluded by decision because it is fed from a 公众号 source), and `podcast` (audio + cover through the modal; its RSS path is excluded). An undeclared `operation` fails by name before any browser or profile work. Mode entry switches the console's `.creator-tab`; the tab set mounts late and every tab renders an `aria-hidden` clone plus an off-screen clone (`x=-9726`), so only the on-screen instance may be clicked. The action bar's `暂存离开` lives in a **closed shadow root** in 图文 (light DOM in 写长文) and is resolved through the shared `findShadowControl` (`@gobing-ai/publish-harness/browser`) — the plugin no longer carries a private CDP walk. The draft signal is the `保存成功` toast plus the `草稿箱` counter, read through `readScopedSignal`; the URL does not change. Live evidence, selectors and drift: `docs/design/xhs-ui-discovery.md`.

**ADR-025 (2026-09-28, after an XHS warning about automated login/publish activity):** every publish first runs a **headless session preflight** (one `goto` + selector reads; the upstream launcher never creates a profile headless, so a missing profile is refused outright) — an unauthenticated session can no longer produce a headed window waiting out the 120 s login gate. Both console visits are then capped at **one headed publish cycle + one session check per 2 h** by `automation-guard.ts` (`~/.config/kk/xhs-automation.json`, override `KK_XHS_AUTOMATION_STATE`); the publish budget is consumed at the headed launch, so a refused preflight leaves the window intact and the operator can retry after logging in. `login` is never automated and never capped; a corrupt state file fails closed. The daily workflow's XHS target ships `xhs_enabled: "true"` (2026-09-29 operator decision; draft-only — `xhs_live` stays a launch-time switch).

`infoq-pub` (0185, ADR-027/E91) is the first of the four target channels built on the shared library: `InfoqBrowserTransport` is `kind: 'browser'`, `driver: 'script'` by default, and the `agent` driver fails fast (`unsupported driver 'agent' for infoq`). The flow runs a headless `checkChannelSession` preflight with `headedFallback: false` — an absent profile or an expired session returns `ok: false` naming `bun plugins/publishings/infoq-pub/src/profile-check.ts login` plus the profile dir path, and never a cookie, page HTML or stack — then opens `https://xie.infoq.cn/write` through upstream `withProfilePage` (headed unless `options.headless === true`) and fills the title, the optional `metadata.summary` and the ProseMirror body through `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))` (E91-D4). `保存草稿` is clicked on every run; `提交` — InfoQ's submit for editorial review, as the site has no self-publish — only when `content.metadata.publishStatus === 'public'` (E91-D5), and any other value returns `ok: false` before a browser opens. Success only from an observed signal (E91-D6): the draft signal is a moved URL carrying an article id (`/\/(\d{4,}|[0-9a-f]{16,})(\/|$|\?)/`) or a visible `保存成功`/`已保存` toast, the live signal a visible `提交成功`/`审核` toast or a moved URL; no signal within 30 s returns `ok: false` naming the control and deadline, and a draft run never clicks `提交`. The Result is `{ ok, target: 'infoq', id?, url?, message, metadata: { driver, publishStatus, profileDir } }`, where `public` reports `infoq submitted for InfoQ editorial review`. Selectors are the wt seed's `title`/`summary`/`body`/`draft`/`live` lists; the operator draft dogfood re-measures `EDITOR_URL`, those selector lists and the draft signal. Operator CLI: `bun plugins/publishings/infoq-pub/src/profile-check.ts login|check [--profile <dir>] [--timeout <ms>]` over the shared `runProfileCli` (exit 0 verified / 1 refused / 2 usage). Profile dir precedence: `--profile` or `options.profileDir` > `INFOQ_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir('infoq')`.

`juejin-pub` (0186, ADR-027/E91) is the second of the four target channels built on the shared library: `JuejinBrowserTransport` is `kind: 'browser'`, `driver: 'script'` by default, and the `agent` driver fails fast (`unsupported driver 'agent' for juejin`). The flow runs the same headless `checkChannelSession` preflight with `headedFallback: false` — an absent profile or an expired session returns `ok: false` naming `bun plugins/publishings/juejin-pub/src/profile-check.ts login` plus the profile dir path, and never a cookie, page HTML or stack — then opens `https://juejin.cn/editor/drafts/new?v=2` through upstream `withProfilePage` (headed unless `options.headless === true`) and fills the title and the bytemd CodeMirror body through `fillCodeMirror(page, SELECTORS.body, content.body)` as **markdown** (no HTML conversion, E91-D4). Juejin autosaves the draft: the flow gives the autosave its 5 s window, presses `Meta+S`/`Control+S` once when the page still showed nothing, and requires the observed signal (E91-D6) — a URL on `/editor/drafts/<id>` or a visible `保存成功` toast — before reporting `ok: true`, `publishStatus: 'draft'`, the observed URL and the URL-carried id; no signal within 30 s returns `ok: false` naming the label and the deadline. The live path runs only for `content.metadata.publishStatus === 'public'` (E91-D5; any other value returns `ok: false` before a browser opens) and needs `content.metadata.category` plus a non-empty `content.metadata.tags`: the popup's `确定并发布` cannot confirm without them, so a live run missing either returns `ok: false` naming the field **before** any browser opens. It then clicks `发布`, picks the `.category-list .item` whose text is exactly the category, types each tag with `Enter`, clicks `确定并发布`, and requires a `/post/`- or `/published/`-shaped URL or a visible `发布成功` toast; a draft run never clicks a live control. The Result is `{ ok, target: 'juejin', id?, url?, message, metadata: { driver, publishStatus, profileDir } }`. Selectors are the wt seed's `title`/`body`/`publish`/`category`/`tagInput`/`confirm` entries; the operator draft dogfood (0192) re-measures `EDITOR_URL`, those selector lists and the draft signal. Operator CLI: `bun plugins/publishings/juejin-pub/src/profile-check.ts login|check [--profile <dir>] [--timeout <ms>]` over the shared `runProfileCli` (exit 0 verified / 1 refused / 2 usage). Profile dir precedence: `--profile` or `options.profileDir` > `JUEJIN_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir('juejin')`.

`substack-pub` (0187, ADR-027/E91) is the third of the four target channels built on the shared library: `SubstackBrowserTransport` is `kind: 'browser'`, `driver: 'script'` by default, and the `agent` driver fails fast (`unsupported driver 'agent' for substack`). The publication is required and publication-scoped (`SUBSTACK_PUBLICATION_URL`, or a per-run `options.publicationUrl`): the editor URL is that URL without its trailing `/` or `/publish`, plus `/publish/post/new`, so an unset, blank or non-`https:` publication returns `ok: false` naming the variable **before** any browser opens. The flow runs the same headless `checkChannelSession` preflight with `headedFallback: false` — an absent profile or an expired session returns `ok: false` naming `bun plugins/publishings/substack-pub/src/profile-check.ts login` plus the profile dir path, and never a cookie, page HTML or stack — then opens the publication's editor through upstream `withProfilePage` (headed unless `options.headless === true`) and fills the title, the optional `metadata.subtitle` and the ProseMirror body through `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))` as **rendered HTML** (E91-D4). Substack autosaves and rewrites the editor URL, so a draft run clicks nothing at all and success comes only from the observed signal (E91-D6): `ok: true`, `publishStatus: 'draft'`, the observed `/publish/post/<id>` URL and its id; no signal within 30 s returns `ok: false` naming the label and the deadline. The live path runs only for `content.metadata.publishStatus === 'public'` (E91-D5; any other value returns `ok: false` before a browser opens): it clicks `Continue`, then `Send to everyone now` — Substack's subscriber email — and requires a `/p/<slug>` or `/publish/posts/published` URL, so a draft run never clicks a live control. The Result is `{ ok, target: 'substack', id?, url?, message, metadata: { driver, publishStatus, profileDir } }`. Selectors are the wt seed's `title`/`subtitle`/`body`/`continue`/`send` lists; the operator draft dogfood (0193) re-measures the editor URL, those selector lists and the draft signal. Operator CLI: `bun plugins/publishings/substack-pub/src/profile-check.ts login|check [--publication <url>] [--profile <dir>] [--timeout <ms>]` over the shared `runProfileCli` (exit 0 verified / 1 refused / 2 usage), taking the publication from `--publication` or `SUBSTACK_PUBLICATION_URL`. Profile dir precedence: `--profile` or `options.profileDir` > `SUBSTACK_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir('substack')`.

`x-pub` `article` (0188, ADR-027/E91) is the fourth target channel built on the shared library: `XArticleBrowserTransport` is `kind: 'browser'`, `driver: 'script'` by default, and the `agent` driver fails fast (`unsupported driver 'agent' for x article`). The flow runs a headless `checkChannelSession` preflight with `headedFallback: false` — an absent profile or an expired session returns `ok: false` naming `bun plugins/publishings/x-pub/src/profile-check.ts login` plus the profile dir path, and never a cookie, token, page HTML or stack — then opens `https://x.com/compose/articles` through upstream `withProfilePage` (headed unless `options.headless === true`), clicks the write control, fills the title (`content.title ?? 'Untitled'`) and inserts the Draft.js body through `pasteHtml(page, SELECTORS.body, markdownToHtml(content.body))` as **rendered HTML** (E91-D4). The optional cover comes from `options.coverPath ?? content.metadata.coverImage` and must be an absolute path to an existing `.png|.jpg|.jpeg|.webp` file — anything else returns `ok: false` naming the path **before** any browser opens; when given, the `addPhotoButton` control is opened (when the composer renders it) and the hidden file input filled with `uploadFile`. X autosaves the composer onto `/compose/articles/edit/<id>`, so success comes only from the observed signal (E91-D6): `ok: true`, `publishStatus: 'draft'`, that URL and its id; no signal within 30 s returns `ok: false` naming the label and the deadline. The live path runs only for `content.metadata.publishStatus === 'public'` (E91-D5; any other value returns `ok: false` before a browser opens): it clicks `Publish` and requires a URL that left `/edit/` and carries the article id, so a draft run never clicks the publish control. The Result is `{ ok, target: 'x', id?, url?, message, metadata: { operation: 'article', driver, publishStatus, profileDir } }`. Selectors are the wt seed's `write`/`title`/`body`/`addPhotos`/`fileInput`/`publish` lists (the seed's `tweetButton`/`Tweet` candidates are dropped — post-composer, tweet risk); the operator draft dogfood (0194) re-measures the composer URL, those selector lists and the edit-URL pattern. Operator CLI: `bun plugins/publishings/x-pub/src/profile-check.ts login|check [--profile <dir>] [--timeout <ms>]` over the shared `runProfileCli` (exit 0 verified / 1 refused / 2 usage). Profile dir precedence: `--profile` or `options.profileDir` > `X_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` > `resolveBrowserProfileDir('x')`. The `post` operation is untouched: `XPostApiTransport` (API v2, OAuth 1.0a) stays `file-cli` and never opens a browser.

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
`--vars '{"vdriver":"ominivoice"}'`); see `docs/design/omni-voice-gen.md`.

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
| Fan-In / Fan-Out Specification | `docs/design/fan-in-and-fan-out-specification.md` | `kk executor fan-in` / `kk executor fan-out` CLI surface, merge + dedupe semantics, aggregate partial-success `Result`, exit codes, `--retry-from` (task 0033) |
| kk product CLI surface | `docs/design/kk-cli-surface.md` | Operator binary `kk`, two-noun tree `executor` + `plugin` (A21 / ADR-011 **shipped** 2026-08-12); A2 bin/help/register tree **shipped** 2026-08-12 |
| STORM evidence cache | `docs/design/storm-evidence-cache.md` | `references/` cache in the 0056 layout, Firecrawl `/v2/scrape` → `markitdown` → body, digest-don't-index report contract (C5 / ADR-013 **shipped** 2026-08-16) |
| ITC generating skill | `docs/design/itc-generating.md` | Fat agent skill `itc-generating` + four distilled references, generic craft & platform playbooks (F3 **shipped** 2026-08-19) |
| Voice generator | `docs/design/voice-gen.md` | Voice generator plugin over local Voicebox REST API (D5 **shipped** 2026-08-19) |
| Solo-podcast workflow | `docs/design/kk-solo-podcast.md` | Product state-machine over voice-gen: HITL outline + VoiceScript + WAV (F5 **shipped** 2026-08-20) |
| Aihot news ingestion | `docs/design/aihot-ingest.md` | Ingestion plugin fetching curated AI news items from aihot.virxact.com into Doc[] (F6 **shipped** 2026-08-21) |
| Daily news generator | `docs/design/dailynews-gen.md` | Generator plugin compiling news Doc[] into broadcast VoiceScript Content (F6 **shipped** 2026-08-21) |
| Daily AI voice workflow | `docs/design/kk-daily-ai-voice.md` | Product state-machine: one collect state (fan-in --source: aihot-ingest + last30days-ingest + horizon-ingest) -> core-facts-gen -> plan (episode-plan-gen + plan-translate) -> content QC (episode-plan-gen filter via EPISODE_PLAN_MODE; empty kept set -> done-no-content) -> article + cover + dailynews-gen script + the `${vars.vdriver}` voice driver (`gemini` -> gemini-tts default (2026-09-29), `voicebox` -> voice-gen, `ominivoice` -> omni-voice-gen; unknown alias fails loud) -> publish (podcast-pub show notes + surfdash-pub/podcast-pub fan-out; failed targets -> publish-partial); daily audio defaults to MP3 with ID3 tags (0171), and `intro-music` joins from the raw render to a distinct `.intro.wav` output (0176) (F61 destination; restructured 2026-09-06 by 0097); the `xhs-write`/`xhs-publish` pair appends a Xiaohongshu card draft (lead-item card plan agent.run -> pinned `xhs-card` x `xhs-knowledge` presets -> `kk stage daily-xhs-render` -> `kk stage daily-publish-xhs`, draft unless `xhs_live`) as an independent, non-blocking target that never enters `publish_status` (E8); the `wechat-publish` state appends a WeChat MP draft (article → `kk stage daily-publish-wechat` → `wechatmp-pub` console browser transport, draft unless `wechat_live`) on the same independent, non-blocking terms (2026-09-29); a publishing run (`publish_enabled`) passes the `safety-review` → `safety-judge` verdict gate between `script` and `review`/`wrap-docs` (0189 R10: `kk stage daily-safety-prep <work_dir> <run_date> <platforms>` + `kk:content-safety` agent.run + `kk:content-judge` compliance agent.run + `kk stage daily-safety-gate <work_dir> <run_date> <safety_max_revise>` → `safety_status` pass\|escalate\|exclude\|revise\|block; the safety verdict must carry a `HIGH\|MEDIUM\|LOW` confidence level — missing or out-of-enum values block (20261003); 20261005 the gate adjusts instead of halting: `revise` loops the drafts through `safety-revise` (`kk:content-safety` detect+revise agent.run + `kk stage daily-safety-revise`, budget `safety_max_revise`, default 2) back into `safety-review`, `exclude` drops the admission-blocked platforms from the run and publishes the rest (the stamp's `excludedPlatforms`, honoured by the per-target stages), escalate always pauses at `review`, and `daily-publish-prep` refuses drafts without a matching pass\|escalate\|exclude digest stamp — only draft-integrity findings (a PII finding on a blocked platform, or a must-pass `fail` outside the admission criteria), an out-of-contract verdict, or edited-after-review drafts reach `failed`); on a `block` the drafts are quarantined to `24-script/.quarantine-<run_date>-judge-block/` instead of being deleted, and the run continues to its normal terminal, so a rejected draft stays on disk for inspection rather than being re-judged in place (20261005); `daily-publish-classify` also records the independent channels' state (en/ja locales, XHS, WeChat, surfdash CMS re-sync) in `31-publish/<run_date>_17_publish_completeness.json` and warns on any gap — those channels never enter `publish_status`, so a hand-driven tail that skips them is otherwise invisible (20261003)|
| Daily voice script plan | `docs/design/daily-voice-script-plan.md` | `script-write` agent.run -> per-item script plan (intro/outro/lead/insight) under a checked-in style contract; dailynews-gen validates + builds from it, template fallback stamped `scriptSource` in the run report (F613 **shipped** 2026-09-25 by 0161+0162: `kk stage daily-script-style` snapshot, `script_write_enabled`+zh guarded `script-write` state with `onError: continue`, `NEWS_REPORT_SCRIPT_FILE` -> `脚本来源` line) |
| Image-gen runtime fallback | `docs/features/D6_image-gen-runtime-fallback.md` | Opt-in `metadata.imageGen.fallback` on the image-gen envelope: absent = strict fail-fast (one provider, original error), `true` = retry down AUTO_ORDER (minus NEVER_AUTO), a list = retry in exactly that order; `metadata.attempts` records every failed provider try `{image, provider, model, errorClass, message}` (present only when non-empty), policy rejections never fall back, and each paid retry is WARN-logged on stderr first (D6 **shipped** 2026-09-25 by 0164–0166) |
| Daily news cover stage | `docs/design/kk-daily-ai-voice.md` | `kk stage daily-cover <work_dir> <run_date> <plugins_path> <provider> <model> <fallback>`: reads the lead-item subject brief, writes the image-gen `--in` envelope pinned to the shipped `daily-news-cover` format x `daily-news` style (subject is the only per-run var, `maxImages: 1`), and runs `kk executor run image-gen`; a missing/invalid brief logs a fallback reason and renders the format's default subject (F614 **shipped** 2026-09-25 by 0163); an empty `<fallback>` (the `cover_fallback` var default) keeps strict fail-fast, `true`/a comma list opts into D6 runtime fallback (0166) |
| Daily XHS card stages | `docs/design/kk-daily-ai-voice.md` §7 | `kk stage daily-xhs-render <work_dir> <run_date> <plugins_path> <count> <style> <provider> <model>`: validates the agent-written lead-item card plan (count vs `xhs_cards`, cover-first, per-field caps), renders one card per `kk executor run image-gen` call sequentially through the pinned `xhs-card` format x the `<style>` preset (default `xhs-knowledge`), reuses a card whose recorded artifact is still on disk, and packages `25-xhs/cards.json` + `25-xhs/content.json` with `metadata.images` in card order and `metadata.publishStatus: draft`. `kk stage daily-publish-xhs <work_dir> <run_date> <plugins_path> <live>`: resolves `draft`|`public` from `<live>` (`xhs_live`, ADR-022) and runs `kk executor run xhs-pub` (default `script` driver, ADR-024), soft on failure and cached per requested status. The pair is an independent, non-blocking target: it never contributes to `publish_status` (E8). `xhs_enabled` ships **on** (2026-09-29 operator decision, ADR-025 amendment; draft-only), and the plugin additionally enforces a headless session preflight plus a 2h publish/check cap (ADR-025) |
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
